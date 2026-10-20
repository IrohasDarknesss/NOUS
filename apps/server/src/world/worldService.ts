// 世界の状態の遷移の操作（BE 詳細設計 world 2章 start・pause・resume・emergency-stop・reset、4章、基本設計書 概要 6章）
// Scheduler（NOUS-59）と recordAudit（admin/audit、NOUS-52）はまだないため、インタフェースだけを受け取る
import { and, count, eq, like, ne } from "drizzle-orm";
import type { Clock } from "../clock/clock";
import { utcDate } from "../clock/clock";
import type { Db } from "../db/client";
import { agents, daily_usage, generation_events, memories, world_settings, worlds } from "../db/schema";
import { withTx, type DbOrTx, type Tx } from "../db/tx";
import { AppError } from "../lib/errors";
import { newUlid } from "../lib/ids";
import type { Logger } from "../lib/logger";
import { isWithinLimits, limitReason, type DailyUsage } from "./limits";
import { canTransition, type WorldState } from "./stateMachine";
import { getWorldTimeSec, settleWorldTime } from "./worldTime";

export type WorldRow = typeof worlds.$inferSelect;
export type WorldSettingsRow = typeof world_settings.$inferSelect;
export type StopReason = NonNullable<WorldRow["stop_reason"]>;

/** Scheduler.stopAll の停止の種類（world 4章） */
export type StopMode = "pause" | "limit" | "emergency";

/** worldService が使う Scheduler の操作（実体は scheduler/scheduler.ts、NOUS-59） */
export interface SchedulerControl {
  /** 新規の割り当てを止め、再試行の待ちを打ち切る。emergency なら実行中も取り消す。戻り値は取り消した件数 */
  stopAll(mode: StopMode): Promise<number>;
  /** loop の待ちを中断して、すぐに状態を確かめ直させる */
  wake(): void;
}

/** 管理操作の記録の1件（admin_auth 4章 recordAudit の entry） */
export interface AuditEntry {
  adminId: string;
  operation: "world.start" | "world.pause" | "world.resume" | "world.emergency_stop" | "world.reset";
  targetType: "world";
  targetId: string;
  before?: unknown;
  after?: unknown;
  worldId: string;
}

/** recordAudit（admin/audit/auditService.ts）。変更と同じトランザクションの中で呼ぶ */
export type AuditRecorder = (tx: Tx, entry: AuditEntry) => void;

/** 操作した管理者（AdminSession のうち、ここで使う項目） */
export interface WorldAdmin {
  adminId: string;
}

export interface WorldServiceDeps {
  db: Db;
  clock: Clock;
  scheduler: SchedulerControl;
  recordAudit: AuditRecorder;
  logger?: Logger;
}

/** 現在の世界（archived 以外の1行。ux_worlds_current により高々1行） */
export function findCurrentWorld(db: DbOrTx): WorldRow | undefined {
  return db.select().from(worlds).where(ne(worlds.state, "archived")).get();
}

export function findWorldSettings(db: DbOrTx, worldId: string): WorldSettingsRow | undefined {
  return db.select().from(world_settings).where(eq(world_settings.world_id, worldId)).get();
}

/** 利用日の利用量。行がなければ 0 */
export function getUsage(db: DbOrTx, usageDate: string): DailyUsage {
  const row = db
    .select({ neurons: daily_usage.neurons, runs: daily_usage.runs })
    .from(daily_usage)
    .where(eq(daily_usage.usage_date, usageDate))
    .get();
  return row ?? { neurons: 0, runs: 0 };
}

/** 世界の status=running の生成イベントの数 */
export function countRunningEvents(db: DbOrTx, worldId: string): number {
  const row = db
    .select({ n: count() })
    .from(generation_events)
    .where(and(eq(generation_events.world_id, worldId), eq(generation_events.status, "running")))
    .get();
  return row?.n ?? 0;
}

function countActiveAgents(db: DbOrTx, worldId: string): number {
  const row = db
    .select({ n: count() })
    .from(agents)
    .where(and(eq(agents.world_id, worldId), eq(agents.state, "active")))
    .get();
  return row?.n ?? 0;
}

/** 「世界 YYYY-MM-DD」。同名があれば「-2」「-3」と番号を足す */
export function nextWorldName(tx: DbOrTx, date: string): string {
  const base = `世界 ${date}`;
  const taken = new Set(
    tx
      .select({ name: worlds.name })
      .from(worlds)
      .where(like(worlds.name, `${base}%`))
      .all()
      .map((r) => r.name),
  );
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const name = `${base}-${n}`;
    if (!taken.has(name)) return name;
  }
}

/** 準備中の世界と既定の world_settings を作る（初回の起動・世界がないとき） */
export function createInitialWorld(tx: Tx, now: Date): WorldRow {
  const nowIso = now.toISOString();
  const worldId = newUlid(now.getTime());
  tx.insert(worlds)
    .values({ world_id: worldId, name: nextWorldName(tx, utcDate(now)), state: "preparing", created_at: nowIso })
    .run();
  tx.insert(world_settings).values({ world_id: worldId, updated_at: nowIso }).run();
  return mustFindWorld(tx, worldId);
}

function mustFindWorld(tx: DbOrTx, worldId: string): WorldRow {
  const row = tx.select().from(worlds).where(eq(worlds.world_id, worldId)).get();
  if (!row) throw new AppError("WORLD_NOT_FOUND");
  return row;
}

function mustFindSettings(tx: DbOrTx, worldId: string): WorldSettingsRow {
  const row = findWorldSettings(tx, worldId);
  if (!row) throw new Error(`world_settings がありません（world_id=${worldId}）`);
  return row;
}

/** 現在の世界を読む。なければ STATE_CONFLICT（画面が読み直す） */
function mustFindCurrentWorld(tx: DbOrTx): WorldRow {
  const row = findCurrentWorld(tx);
  if (!row) throw new AppError("STATE_CONFLICT");
  return row;
}

/**
 * 状態を楽観の確認つきで書き換える（world 3章 updateWorldState）。
 * world_id と state が読んだときのままでなければ 0 行になり、STATE_CONFLICT
 */
function updateWorldState(
  tx: Tx,
  world: Pick<WorldRow, "world_id" | "state">,
  values: Partial<Omit<WorldRow, "world_id">>,
): void {
  const result = tx
    .update(worlds)
    .set(values)
    .where(and(eq(worlds.world_id, world.world_id), eq(worlds.state, world.state)))
    .run();
  if (result.changes === 0) throw new AppError("STATE_CONFLICT");
}

/**
 * running でない state へ移す。running からなら settleWorldTime で世界内時間の確定と同じ UPDATE で書き、
 * それ以外は updateWorldState。どちらも楽観の確認で 0 行なら STATE_CONFLICT
 */
function settleOrUpdate(tx: Tx, world: WorldRow, now: Date, next: Parameters<typeof settleWorldTime>[3]): void {
  if (world.state === "running") {
    if (settleWorldTime(tx, world, now, next) === null) throw new AppError("STATE_CONFLICT");
    return;
  }
  updateWorldState(tx, world, next);
}

/** 遷移先の state が、上限の中なら running、そうでなければ limit_stopped と理由 */
function runningOrLimitStopped(
  tx: Tx,
  settings: WorldSettingsRow,
  now: Date,
): { state: "running" } | { state: "limit_stopped"; stopReason: StopReason } {
  const usage = getUsage(tx, utcDate(now));
  if (isWithinLimits(usage, settings)) return { state: "running" };
  return { state: "limit_stopped", stopReason: limitReason(usage, settings) ?? "neurons_limit" };
}

/**
 * 世界の状態の遷移の操作。Clock・DB・Scheduler・recordAudit を受け取って作る
 */
export function createWorldService(deps: WorldServiceDeps) {
  const { db, clock, scheduler, recordAudit, logger } = deps;

  /** 待たずに stopAll を流す（pause：実行中の LLM の呼び出しは完了を待つため、API は先に返す） */
  const stopInBackground = (mode: StopMode): void => {
    scheduler.stopAll(mode).catch((err: unknown) => {
      logger?.error("Scheduler.stopAll に失敗しました", { mode, err: String(err) });
    });
  };

  /** 2章 start：準備中の世界を開始する（上限に達していれば limit_stopped） */
  function startWorld(admin: WorldAdmin): { state: WorldState; startedAt: string } {
    const now = clock.now();
    const nowIso = now.toISOString();
    const result = withTx(db, (tx) => {
      const world = mustFindCurrentWorld(tx);
      if (world.state !== "preparing") throw new AppError("STATE_CONFLICT");
      if (countActiveAgents(tx, world.world_id) === 0) throw new AppError("NO_AGENTS");
      const next = runningOrLimitStopped(tx, mustFindSettings(tx, world.world_id), now);
      if (next.state === "running") {
        updateWorldState(tx, world, {
          state: "running",
          stop_reason: null,
          running_since: nowIso,
          heartbeat_at: nowIso,
          started_at: nowIso,
          next_cycle_at: nowIso,
        });
      } else {
        // 準備中から直接 limit_stopped（world 2章 start の手順 2）。世界内時間は進めない
        updateWorldState(tx, world, { state: "limit_stopped", stop_reason: next.stopReason, started_at: nowIso });
      }
      recordAudit(tx, {
        adminId: admin.adminId,
        operation: "world.start",
        targetType: "world",
        targetId: world.world_id,
        before: { state: world.state },
        after: { state: next.state },
        worldId: world.world_id,
      });
      return { state: next.state, startedAt: nowIso };
    });
    if (result.state === "running") scheduler.wake();
    return result;
  }

  /** 2章 pause：稼働・上限停止の世界を一時停止する */
  function pauseWorld(admin: WorldAdmin): { state: WorldState; worldTimeSec: number; runningGenerations: number } {
    const now = clock.now();
    const result = withTx(db, (tx) => {
      const world = mustFindCurrentWorld(tx);
      if (!canTransition(world.state, "paused")) throw new AppError("STATE_CONFLICT");
      // running からなら世界内時間を確定する（state と同じ UPDATE）
      const worldTimeSec = getWorldTimeSec(world, now);
      settleOrUpdate(tx, world, now, { state: "paused", stop_reason: "manual_pause" });
      recordAudit(tx, {
        adminId: admin.adminId,
        operation: "world.pause",
        targetType: "world",
        targetId: world.world_id,
        before: { state: world.state },
        after: { state: "paused" },
        worldId: world.world_id,
      });
      return { state: "paused" as const, worldTimeSec, runningGenerations: countRunningEvents(tx, world.world_id) };
    });
    stopInBackground("pause");
    return result;
  }

  /** 2章 resume：一時停止・緊急停止の世界を再開する（上限に達していれば limit_stopped） */
  function resumeWorld(admin: WorldAdmin): { state: WorldState; stopReason: StopReason | null } {
    const now = clock.now();
    const nowIso = now.toISOString();
    const result = withTx(db, (tx) => {
      const world = mustFindCurrentWorld(tx);
      // limit_stopped → running は日の区切り・上限の引き上げの遷移なので、再開の操作では受けない
      if (world.state !== "paused" && world.state !== "emergency_stopped") throw new AppError("STATE_CONFLICT");
      const next = runningOrLimitStopped(tx, mustFindSettings(tx, world.world_id), now);
      if (!canTransition(world.state, next.state)) throw new AppError("STATE_CONFLICT");
      let stopReason: StopReason | null = null;
      if (next.state === "running") {
        const planned = world.next_cycle_at;
        updateWorldState(tx, world, {
          state: "running",
          stop_reason: null,
          running_since: nowIso,
          heartbeat_at: nowIso,
          next_cycle_at: planned !== null && Date.parse(planned) > now.getTime() ? planned : nowIso,
        });
      } else {
        stopReason = next.stopReason;
        updateWorldState(tx, world, { state: "limit_stopped", stop_reason: stopReason });
      }
      recordAudit(tx, {
        adminId: admin.adminId,
        operation: "world.resume",
        targetType: "world",
        targetId: world.world_id,
        before: { state: world.state, stopReason: world.stop_reason },
        after: { state: next.state, stopReason },
        worldId: world.world_id,
      });
      return { state: next.state, stopReason };
    });
    if (result.state === "running") scheduler.wake();
    return result;
  }

  /** 2章 emergency-stop：実行中の生成を取り消して即時に止める。戻り値は取り消した件数 */
  async function emergencyStopWorld(admin: WorldAdmin): Promise<{ state: WorldState; cancelledGenerations: number }> {
    const now = clock.now();
    withTx(db, (tx) => {
      const world = mustFindCurrentWorld(tx);
      if (!canTransition(world.state, "emergency_stopped")) throw new AppError("STATE_CONFLICT");
      settleOrUpdate(tx, world, now, { state: "emergency_stopped", stop_reason: "emergency" });
      recordAudit(tx, {
        adminId: admin.adminId,
        operation: "world.emergency_stop",
        targetType: "world",
        targetId: world.world_id,
        before: { state: world.state },
        after: { state: "emergency_stopped" },
        worldId: world.world_id,
      });
    });
    // 実行中の AbortController の abort、5 秒の待ち、閉じない生成イベントの cancelled は Scheduler が行う（手順 2・3）
    const cancelledGenerations = await scheduler.stopAll("emergency");
    return { state: "emergency_stopped", cancelledGenerations };
  }

  /**
   * 2章 reset：現在の世界をアーカイブにし、同じエージェントと設定を写した新しい世界を準備中で作る。
   * running・preparing はリセットできない（STATE_CONFLICT）
   */
  function resetWorld(
    admin: WorldAdmin,
    confirmName: string,
  ): { archivedWorldId: string; newWorldId: string; state: "preparing" } {
    const now = clock.now();
    const nowIso = now.toISOString();
    return withTx(db, (tx) => {
      const world = mustFindCurrentWorld(tx);
      if (!canTransition(world.state, "archived")) throw new AppError("STATE_CONFLICT");
      if (confirmName !== world.name) throw new AppError("CONFIRM_MISMATCH");
      if (countRunningEvents(tx, world.world_id) > 0) throw new AppError("GENERATION_RUNNING");
      const settings = mustFindSettings(tx, world.world_id);

      // 手順 2：旧の世界を archived に（ux_worlds_current のため、新しい世界より先に）
      updateWorldState(tx, world, { state: "archived", archived_at: nowIso });

      // 手順 3：新しい世界と world_settings（現在の値を写す）
      const newWorldId = newUlid(now.getTime());
      tx.insert(worlds)
        .values({ world_id: newWorldId, name: nextWorldName(tx, utcDate(now)), state: "preparing", created_at: nowIso })
        .run();
      tx.insert(world_settings)
        .values({ ...settings, world_id: newWorldId, updated_at: nowIso })
        .run();

      // 手順 4：エージェントを新しい agent_id で写し、interest_profile の記憶を作る
      copyAgentsToWorld(tx, world.world_id, newWorldId, now);

      // 手順 5：監査。手順 6：daily_usage は利用日の単位のため何もしない
      recordAudit(tx, {
        adminId: admin.adminId,
        operation: "world.reset",
        targetType: "world",
        targetId: world.world_id,
        before: { worldId: world.world_id },
        after: { worldId: newWorldId },
        worldId: world.world_id,
      });
      return { archivedWorldId: world.world_id, newWorldId, state: "preparing" as const };
    });
  }

  /**
   * 上限に達したときに limit_stopped にする（Scheduler・行動生成から呼ぶ）。監査は残さない（理由は worlds.stop_reason）。
   * running のときだけ遷移する。すでに limit_stopped、または管理者が先に止めていれば何もしない
   */
  async function enterLimitStopped(reason: "neurons_limit" | "runs_limit" | "free_tier_error"): Promise<void> {
    const now = clock.now();
    const changed = withTx(db, (tx) => {
      const world = findCurrentWorld(tx);
      if (!world || world.state !== "running") return false;
      return settleWorldTime(tx, world, now, { state: "limit_stopped", stop_reason: reason }) !== null;
    });
    if (changed) await scheduler.stopAll("limit");
  }

  return { startWorld, pauseWorld, resumeWorld, emergencyStopWorld, resetWorld, enterLimitStopped };
}

export type WorldService = ReturnType<typeof createWorldService>;

/** 世界の agents を新しい agent_id で写す（world 3章 copyAgentsToWorld。最大 30 体） */
function copyAgentsToWorld(tx: Tx, fromWorldId: string, toWorldId: string, now: Date): void {
  const nowIso = now.toISOString();
  const rows = tx.select().from(agents).where(eq(agents.world_id, fromWorldId)).orderBy(agents.created_at).all();
  for (const agent of rows) {
    const agentId = newUlid(now.getTime());
    tx.insert(agents)
      .values({
        ...agent,
        agent_id: agentId,
        world_id: toWorldId,
        state: "active",
        created_at: nowIso,
        updated_at: nowIso,
      })
      .run();
    tx.insert(memories)
      .values({
        memory_id: newUlid(now.getTime()),
        agent_id: agentId,
        kind: "interest_profile",
        content: interestProfileOf(tx, agent),
        updated_at: nowIso,
      })
      .run();
  }
}

/**
 * 写すエージェントの interest_profile。人格・属性は同じなので旧の記憶をそのまま使う。
 * 旧の記憶がなければ、admin_data 4章 buildInterestProfile と同じ形の1文を 200 字までで作る
 */
function interestProfileOf(tx: Tx, agent: typeof agents.$inferSelect): string {
  const old = tx
    .select({ content: memories.content })
    .from(memories)
    .where(and(eq(memories.agent_id, agent.agent_id), eq(memories.kind, "interest_profile")))
    .get();
  if (old) return old.content;
  return `興味：${agent.interests}。関心：${agent.topics}。大事にしていること：${agent.values_text}`.slice(0, 200);
}
