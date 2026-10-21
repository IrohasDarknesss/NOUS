// Scheduler：B01 1巡の実行と停止の指示（BE 詳細設計 world 1章・4章 Scheduler.start・loop・runCycle・stopAll・wake、5章 B01、6章）。
// 世界が running の間、周期（world_settings.cycle_minutes）ごとに 1 巡を実行し、active のエージェントへ
// runOpportunity を同時に max_concurrency 件までで割り当てる。時刻と待ちはすべて Clock を通す。
// B08（生存時刻）・B02（日の区切り）のタイマーは main.ts が scheduleHeartbeat・scheduleDayRollover で張る（NOUS-59 で整理）。
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { utcDate, type Clock } from "../clock/clock";
import type { GenerationConfig } from "../config/generationConfig";
import type { Db } from "../db/client";
import { agents, generation_events, worlds } from "../db/schema";
import { withTx } from "../db/tx";
import { runOpportunity as defaultRunOpportunity } from "../generation/opportunityRunner";
import { createRng } from "../generation/rng";
import type { Logger } from "../lib/logger";
import { FreeTierExceededError, type LlmClient } from "../llm/llmClient";
import { isWithinLimits, limitReason, type LimitReason } from "../world/limits";
import {
  createWorldService,
  findCurrentWorld,
  findWorldSettings,
  getUsage,
  type SchedulerControl,
  type StopMode,
  type WorldRow,
  type WorldSettingsRow,
} from "../world/worldService";

/** 世界が running でないときに、状態を確かめ直す間隔（wake でも中断する） */
export const IDLE_CHECK_MS = 60_000;
/** loop の想定外の例外の後に待つ時間（6章） */
export const ERROR_BACKOFF_MS = 60_000;
/** 緊急停止で、取り消した行動機会が終わるのを待つ上限（4章 stopAll、NFR-P-006） */
export const EMERGENCY_WAIT_MS = 5_000;

export type EnterLimitStopped = (reason: LimitReason | "free_tier_error") => Promise<void>;

export interface SchedulerDeps {
  db: Db;
  clock: Clock;
  logger: Logger;
  llm: LlmClient;
  config: GenerationConfig;
  llmMode: "cloudflare" | "fixed";
  /** テストでの差し替え用。既定は generation/opportunityRunner.ts の runOpportunity */
  runOpportunity?: typeof defaultRunOpportunity;
  /** テストでの差し替え用。既定は worldService の enterLimitStopped */
  enterLimitStopped?: EnterLimitStopped;
  /** 巡の乱数の種を作る（0 以上 1 未満）。既定は Math.random */
  random?: () => number;
  /** runOpportunity にそのまま渡す（テスト用のテンプレートの置き場所） */
  promptsDir?: string;
}

/** worldService の SchedulerControl と、main.ts の AppScheduler（start・stop）を満たす */
export interface Scheduler extends SchedulerControl {
  /** loop を始める（2 回呼んでも 1 つだけ） */
  start(): void;
  /** プロセスの終了用。loop を終わらせ、実行中の行動機会を取り消して終わるのを待つ */
  stop(): Promise<void>;
  /** いま実行中の行動機会の数 */
  runningCount(): number;
  /**
   * loop の 1 回分：現在の世界が running で next_cycle_at を過ぎていれば 1 巡を実行し、next_cycle_at を進める。
   * 巡を実行したら true。loop の中から呼ぶほか、テストで待ちを挟まずに巡を確かめるのに使う
   */
  runDueCycle(): Promise<boolean>;
}

type InFlight = {
  controller: AbortController;
  stopController: AbortController;
  done: Promise<void>;
};

/** 種から作る乱数で並べ替える（Fisher–Yates）。同じ種なら同じ順 */
export function shuffleBySeed<T>(items: readonly T[], seed: number): T[] {
  const rng = createRng(seed, "cycle-order");
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

/** 活動量の割合（activity_percent）で選ぶ体数。切り上げで、1 体以上いれば最低 1 体 */
export function pickCount(total: number, activityPercent: number): number {
  if (total <= 0) return 0;
  return Math.min(total, Math.max(1, Math.ceil((total * activityPercent) / 100)));
}

export function createScheduler(deps: SchedulerDeps): Scheduler {
  const { db, clock, logger } = deps;
  const run = deps.runOpportunity ?? defaultRunOpportunity;
  const random = deps.random ?? Math.random;

  let started = false;
  let closed = false;
  let loopPromise: Promise<void> | null = null;
  /** 新規の割り当てを止めるフラグ（stopAll で立て、次に新しい巡を始めるときに下ろす） */
  let stopRequested = false;
  /** sleep 中なら、wake で abort する */
  let wakeController: AbortController | null = null;
  /** sleep 中でないときに wake されたら、次の待ちをすぐに終わらせる */
  let wakePending = false;
  const inFlight = new Set<InFlight>();

  // 既定の enterLimitStopped は、この scheduler を渡した worldService から作るので、scheduler を作った後に決める
  let enterLimitStopped: EnterLimitStopped = async () => {};

  /** wake で中断できる待ち。closed なら待たない */
  async function sleepUntilWake(ms: number): Promise<void> {
    if (closed) return;
    if (wakePending) {
      wakePending = false;
      return;
    }
    const controller = new AbortController();
    wakeController = controller;
    try {
      await clock.sleep(ms, controller.signal);
    } catch (err) {
      if (!controller.signal.aborted) throw err;
    } finally {
      if (wakeController === controller) wakeController = null;
    }
  }

  function isWorldRunning(worldId: string): boolean {
    const world = findCurrentWorld(db);
    return world !== undefined && world.world_id === worldId && world.state === "running";
  }

  /** 新しい行動機会を割り当ててよいか（停止の指示・世界の状態・その日の上限） */
  function canAssign(worldId: string): boolean {
    if (closed || stopRequested || !isWorldRunning(worldId)) return false;
    const settings = findWorldSettings(db, worldId);
    if (!settings) return false;
    return isWithinLimits(getUsage(db, utcDate(clock.now())), settings);
  }

  /** 1 件の行動機会。FreeTierExceededError と上限の超過は上限停止にする */
  async function runOne(worldId: string, agentId: string, cycleNo: number, cycleSeed: number): Promise<void> {
    const controller = new AbortController();
    const stopController = new AbortController();
    const entry: InFlight = { controller, stopController, done: Promise.resolve() };
    entry.done = (async () => {
      try {
        await run({
          db,
          clock,
          llm: deps.llm,
          config: deps.config,
          logger,
          llmMode: deps.llmMode,
          worldId,
          agentId,
          cycleNo,
          cycleSeed,
          signal: controller.signal,
          stopSignal: stopController.signal,
          shouldContinue: () => !closed && !stopRequested && isWorldRunning(worldId),
          ...(deps.promptsDir !== undefined ? { promptsDir: deps.promptsDir } : {}),
        });
      } catch (err) {
        if (err instanceof FreeTierExceededError) {
          logger.warn("無料枠の上限に達したため上限停止にします", { worldId, agentId });
          await enterLimitStopped("free_tier_error");
          return;
        }
        logger.error("行動機会の実行に失敗しました", {
          worldId,
          agentId,
          error: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
        });
      }
      // 各行動機会の後に上限を確かめる（4章 runCycle 5）
      const settings = findWorldSettings(db, worldId);
      if (settings) {
        const reason = limitReason(getUsage(db, utcDate(clock.now())), settings);
        if (reason !== null) await enterLimitStopped(reason);
      }
    })();
    inFlight.add(entry);
    try {
      await entry.done;
    } finally {
      inFlight.delete(entry);
    }
  }

  /** 4章 runCycle */
  async function runCycle(world: WorldRow, settings: WorldSettingsRow): Promise<void> {
    const cycleSeed = Math.floor(random() * 2 ** 32) >>> 0;
    const cycleNo = withTx(db, (tx) => {
      const row = tx
        .update(worlds)
        .set({ cycle_no: sql`${worlds.cycle_no} + 1` })
        .where(eq(worlds.world_id, world.world_id))
        .returning({ cycle_no: worlds.cycle_no })
        .get();
      return row?.cycle_no ?? world.cycle_no + 1;
    });

    const active = db
      .select({ agent_id: agents.agent_id })
      .from(agents)
      .where(and(eq(agents.world_id, world.world_id), eq(agents.state, "active")))
      .orderBy(asc(agents.created_at), asc(agents.agent_id))
      .all()
      .map((r) => r.agent_id);
    const targets = shuffleBySeed(active, cycleSeed).slice(0, pickCount(active.length, settings.activity_percent));
    logger.info("1巡を始めます", { worldId: world.world_id, cycleNo, agents: targets.length });

    let next = 0;
    const worker = async (): Promise<void> => {
      for (;;) {
        if (!canAssign(world.world_id)) return;
        const agentId = targets[next];
        if (agentId === undefined) return;
        next += 1;
        await runOne(world.world_id, agentId, cycleNo, cycleSeed);
      }
    };
    const concurrency = Math.max(1, Math.min(settings.max_concurrency, targets.length));
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
  }

  async function runDueCycle(): Promise<boolean> {
    const world = findCurrentWorld(db);
    if (!world || world.state !== "running") return false;
    if (world.next_cycle_at !== null && Date.parse(world.next_cycle_at) > clock.nowMs()) return false;
    const settings = findWorldSettings(db, world.world_id);
    if (!settings) throw new Error(`world_settings がありません: ${world.world_id}`);

    // 新しい巡を始めるので、前の停止の指示を下ろす（再開・日の区切りの後）
    stopRequested = false;
    const startedMs = clock.nowMs();
    await runCycle(world, settings);
    // 次の巡 = 巡の開始＋周期。ただし巡の終わりより前なら巡の終わり（1巡が周期より長ければ遅らせる）
    const nextMs = Math.max(startedMs + settings.cycle_minutes * 60_000, clock.nowMs());
    db.update(worlds)
      .set({ next_cycle_at: new Date(nextMs).toISOString() })
      .where(eq(worlds.world_id, world.world_id))
      .run();
    return true;
  }

  /** 4章 loop */
  async function loop(): Promise<void> {
    while (!closed) {
      try {
        if (await runDueCycle()) continue;
        const world = findCurrentWorld(db);
        if (world && world.state === "running" && world.next_cycle_at !== null) {
          const waitMs = Date.parse(world.next_cycle_at) - clock.nowMs();
          await sleepUntilWake(Math.max(0, Math.min(waitMs, IDLE_CHECK_MS)));
        } else {
          await sleepUntilWake(IDLE_CHECK_MS);
        }
      } catch (err) {
        logger.error("スケジューラーで想定外の例外が起きました", {
          error: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
        });
        await sleepUntilWake(ERROR_BACKOFF_MS);
      }
    }
  }

  /** 現在の世界の status=running の生成イベントの ID */
  function runningEventIds(): string[] {
    const world = findCurrentWorld(db);
    if (!world) return [];
    return db
      .select({ event_id: generation_events.event_id })
      .from(generation_events)
      .where(and(eq(generation_events.world_id, world.world_id), eq(generation_events.status, "running")))
      .all()
      .map((r) => r.event_id);
  }

  /** 4章 stopAll。emergency のとき、取り消した生成イベントの数を返す */
  async function stopAll(mode: StopMode): Promise<number> {
    // 1. 新規の割り当てを止める（shouldContinue も false を返す）。pause・limit は再試行の待ちも stopSignal で打ち切る（NOUS-83）
    stopRequested = true;
    wake();
    if (mode !== "emergency") {
      for (const entry of inFlight) entry.stopController.abort();
      return 0;
    }

    // 2. 実行中の AbortController をすべて abort し、最大 5 秒待つ
    const before = new Set(runningEventIds());
    const entries = [...inFlight];
    for (const entry of entries) entry.controller.abort();
    if (entries.length > 0) {
      const timer = new AbortController();
      await Promise.race([
        Promise.allSettled(entries.map((e) => e.done)),
        clock.sleep(EMERGENCY_WAIT_MS, timer.signal).catch(() => {}),
      ]);
      timer.abort();
    }

    // 3. 5 秒を過ぎても running の行は cancelled に直す
    const stuck = runningEventIds();
    if (stuck.length > 0) {
      db.update(generation_events)
        .set({ status: "cancelled", failure_kind: "cancelled", finished_at: clock.nowIso() })
        .where(and(inArray(generation_events.event_id, stuck), eq(generation_events.status, "running")))
        .run();
      logger.warn("緊急停止の後も終わらない生成イベントを取り消しました", { count: stuck.length });
    }
    for (const id of stuck) before.add(id);
    return before.size;
  }

  function wake(): void {
    if (wakeController) {
      wakeController.abort();
    } else {
      wakePending = true;
    }
  }

  const scheduler: Scheduler = {
    start(): void {
      if (started || closed) return;
      started = true;
      loopPromise = loop();
    },
    async stop(): Promise<void> {
      closed = true;
      stopRequested = true;
      for (const entry of inFlight) entry.controller.abort();
      wake();
      await loopPromise;
      await Promise.allSettled([...inFlight].map((e) => e.done));
    },
    stopAll,
    wake,
    runningCount: () => inFlight.size,
    runDueCycle,
  };

  if (deps.enterLimitStopped) {
    enterLimitStopped = deps.enterLimitStopped;
  } else {
    // enterLimitStopped は監査を残さない（world 4章）。recordAudit が呼ばれたらプログラムの誤り
    const worldService = createWorldService({
      db,
      clock,
      scheduler,
      recordAudit: () => {
        throw new Error("Scheduler の enterLimitStopped では監査を残しません");
      },
      logger,
    });
    enterLimitStopped = (reason) => worldService.enterLimitStopped(reason);
  }

  return scheduler;
}
