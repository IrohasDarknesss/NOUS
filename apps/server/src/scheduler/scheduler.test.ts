import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SEED_NOW, seedAgent, seedEvent, seedRunningWorld } from "../../test/helpers/generationSeed";
import { createTestDb, type TestDb } from "../../test/helpers/testDb";
import { FakeClock } from "../clock/fakeClock";
import type { GenerationConfig } from "../config/generationConfig";
import { daily_usage, generation_events, world_settings, worlds } from "../db/schema";
import type { OpportunityContext, OpportunityResult } from "../generation/opportunityRunner";
import { createLogger } from "../lib/logger";
import { FreeTierExceededError, type LlmClient } from "../llm/llmClient";
import { createScheduler, EMERGENCY_WAIT_MS, pickCount, shuffleBySeed, type SchedulerDeps } from "./scheduler";

const config: GenerationConfig = {
  participation: { "1": 0.3, "2": 0.45, "3": 0.6, "4": 0.75, "5": 0.9 },
  candidateCount: 2,
  weights: { post: 3, reply: 3, like: 2.5, follow: 1.5, unfollow: 0.5 },
  recentPenalty: 0.4,
  firstPersonRules: [],
};
const llm: LlmClient = { generate: async () => Promise.reject(new Error("呼ばれない")) };
const ok: OpportunityResult = {
  eventId: null,
  status: "succeeded",
  action: "post",
  decidedBy: "llm",
  neurons: 0,
  failureKind: null,
};

/** 呼ばれた ctx を記録し、release するまで終わらない runOpportunity */
function controllableRun() {
  const calls: OpportunityContext[] = [];
  const releases: (() => void)[] = [];
  let running = 0;
  let maxRunning = 0;
  const run = vi.fn(async (ctx: OpportunityContext): Promise<OpportunityResult> => {
    calls.push(ctx);
    running += 1;
    maxRunning = Math.max(maxRunning, running);
    try {
      await new Promise<void>((resolve, reject) => {
        releases.push(resolve);
        ctx.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
      return ok;
    } finally {
      running -= 1;
    }
  });
  return {
    run,
    calls,
    releaseAll: () => releases.splice(0).forEach((r) => r()),
    maxRunning: () => maxRunning,
  };
}

/** setImmediate を挟んで Promise の続きを流す */
const flush = async (times = 5): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise<void>((r) => setImmediate(r));
};

describe("Scheduler（world 4章・5章 B01）", () => {
  let t: TestDb;
  let clock: FakeClock;
  let worldId: string;
  const logger = createLogger({ sinks: [() => {}] });

  const deps = (over: Partial<SchedulerDeps> = {}): SchedulerDeps => ({
    db: t.db,
    clock,
    logger,
    llm,
    config,
    llmMode: "fixed",
    random: () => 0.5,
    enterLimitStopped: vi.fn(async () => {}),
    runOpportunity: vi.fn(async () => ok),
    ...over,
  });
  const setSettings = (values: Partial<typeof world_settings.$inferInsert>): void => {
    t.db.update(world_settings).set(values).where(eq(world_settings.world_id, worldId)).run();
  };
  const world = () => t.db.select().from(worlds).where(eq(worlds.world_id, worldId)).get();

  beforeEach(() => {
    t = createTestDb();
    clock = new FakeClock(Date.parse(SEED_NOW));
    worldId = seedRunningWorld(t.db);
  });
  afterEach(() => {
    t.cleanup();
  });

  it("TC-NOUS59_DEV-01 running の世界で 1 巡を実行し、active の全員に 1 回ずつ割り当てる（停止中の住人は除く）", async () => {
    const a = seedAgent(t.db, worldId, "minato");
    const b = seedAgent(t.db, worldId, "haruka");
    seedAgent(t.db, worldId, "zen", { state: "stopped" });
    const run = vi.fn<(ctx: OpportunityContext) => Promise<OpportunityResult>>(async () => ok);
    const s = createScheduler(deps({ runOpportunity: run }));

    expect(await s.runDueCycle()).toBe(true);
    const agentIds = run.mock.calls.map(([c]) => c.agentId).sort();
    expect(agentIds).toEqual([a, b].sort());
    const ctx = run.mock.calls[0]?.[0] as OpportunityContext;
    expect(ctx).toMatchObject({ worldId, cycleNo: 1, llmMode: "fixed", config, llm });
    expect(ctx.signal).toBeInstanceOf(AbortSignal);
    expect(ctx.shouldContinue()).toBe(true);
    expect(world()?.cycle_no).toBe(1);
  });

  it("TC-NOUS59_DEV-02 次の巡は周期の後（next_cycle_at = 巡の開始＋cycle_minutes）で、それまでは巡を始めない", async () => {
    seedAgent(t.db, worldId, "minato");
    setSettings({ cycle_minutes: 20 });
    const run = vi.fn(async () => ok);
    const s = createScheduler(deps({ runOpportunity: run }));

    await s.runDueCycle();
    expect(world()?.next_cycle_at).toBe(new Date(Date.parse(SEED_NOW) + 20 * 60_000).toISOString());
    expect(await s.runDueCycle()).toBe(false);
    await clock.advance(20 * 60_000);
    expect(await s.runDueCycle()).toBe(true);
    expect(run).toHaveBeenCalledTimes(2);
    expect(world()?.cycle_no).toBe(2);
  });

  it("TC-NOUS59_DEV-03 1巡が周期より長ければ、次の巡は巡の終わりまで遅らせる", async () => {
    seedAgent(t.db, worldId, "minato");
    setSettings({ cycle_minutes: 15 });
    const run = vi.fn(async () => {
      await clock.advance(20 * 60_000);
      return ok;
    });
    const s = createScheduler(deps({ runOpportunity: run }));
    await s.runDueCycle();
    expect(world()?.next_cycle_at).toBe(new Date(Date.parse(SEED_NOW) + 20 * 60_000).toISOString());
  });

  it.each([
    ["TC-NOUS59_DEV-04", 1],
    ["TC-NOUS59_DEV-05", 2],
  ])("%s max_concurrency=%i を超えて同時に runOpportunity を呼ばない", async (_id, maxConcurrency) => {
    for (const h of ["minato", "haruka", "zen", "riko"]) seedAgent(t.db, worldId, h);
    setSettings({ max_concurrency: maxConcurrency });
    const c = controllableRun();
    const s = createScheduler(deps({ runOpportunity: c.run }));
    const cycle = s.runDueCycle();
    for (let i = 0; i < 4; i++) {
      await flush();
      expect(s.runningCount()).toBeLessThanOrEqual(maxConcurrency);
      c.releaseAll();
    }
    await cycle;
    expect(c.calls).toHaveLength(4);
    expect(c.maxRunning()).toBe(maxConcurrency);
  });

  it("TC-NOUS59_DEV-06 世界が running でなければ巡を始めない", async () => {
    seedAgent(t.db, worldId, "minato");
    t.db.update(worlds).set({ state: "paused", running_since: null }).where(eq(worlds.world_id, worldId)).run();
    const run = vi.fn(async () => ok);
    const s = createScheduler(deps({ runOpportunity: run }));
    expect(await s.runDueCycle()).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it("TC-NOUS59_DEV-07 start した loop は、running でない間は待ち、wake で確かめ直して巡を始める", async () => {
    seedAgent(t.db, worldId, "minato");
    t.db.update(worlds).set({ state: "paused", running_since: null }).where(eq(worlds.world_id, worldId)).run();
    const run = vi.fn(async () => ok);
    const s = createScheduler(deps({ runOpportunity: run }));
    s.start();
    await flush();
    expect(run).not.toHaveBeenCalled();
    t.db.update(worlds).set({ state: "running", running_since: SEED_NOW }).where(eq(worlds.world_id, worldId)).run();
    s.wake();
    await flush();
    expect(run).toHaveBeenCalledTimes(1);
    await s.stop();
  });

  it("TC-NOUS59_DEV-08 activity_percent の割合（切り上げ）だけ選び、同じ種なら同じ順", async () => {
    expect(pickCount(10, 100)).toBe(10);
    expect(pickCount(10, 35)).toBe(4);
    expect(pickCount(3, 10)).toBe(1);
    expect(pickCount(0, 50)).toBe(0);
    const items = ["a", "b", "c", "d", "e", "f"];
    expect(shuffleBySeed(items, 101)).toEqual(shuffleBySeed(items, 101));
    expect([...shuffleBySeed(items, 101)].sort()).toEqual(items);

    for (const h of ["minato", "haruka", "zen", "riko"]) seedAgent(t.db, worldId, h);
    setSettings({ activity_percent: 50 });
    const run = vi.fn(async () => ok);
    await createScheduler(deps({ runOpportunity: run })).runDueCycle();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("TC-NOUS59_DEV-09 stopAll('pause') の後は新しい割り当てをせず、shouldContinue が false になり、0 を返す", async () => {
    for (const h of ["minato", "haruka", "zen"]) seedAgent(t.db, worldId, h);
    setSettings({ max_concurrency: 1 });
    const c = controllableRun();
    const s = createScheduler(deps({ runOpportunity: c.run }));
    const cycle = s.runDueCycle();
    await flush();
    expect(c.calls).toHaveLength(1);
    expect(await s.stopAll("pause")).toBe(0);
    expect(c.calls[0]?.shouldContinue()).toBe(false);
    expect(c.calls[0]?.signal.aborted).toBe(false);
    c.releaseAll();
    await cycle;
    expect(c.calls).toHaveLength(1);
  });

  it("TC-NOUS59_DEV-10 stopAll('emergency') は実行中の AbortController を止め、取り消した件数を返す", async () => {
    const a = seedAgent(t.db, worldId, "minato");
    const b = seedAgent(t.db, worldId, "haruka");
    setSettings({ max_concurrency: 2 });
    const c = controllableRun();
    // 実行中の行動機会に対応する running の生成イベント
    const e1 = seedEvent(t.db, worldId, a);
    const e2 = seedEvent(t.db, worldId, b);
    const run = vi.fn(async (ctx: OpportunityContext) => {
      try {
        return await c.run(ctx);
      } finally {
        // runOpportunity が取り消しで閉じるのと同じ
        const eventId = ctx.agentId === a ? e1 : e2;
        t.db
          .update(generation_events)
          .set({ status: "cancelled", failure_kind: "cancelled", finished_at: clock.nowIso() })
          .where(eq(generation_events.event_id, eventId))
          .run();
      }
    });
    const s = createScheduler(deps({ runOpportunity: run }));
    const cycle = s.runDueCycle();
    await flush();
    expect(s.runningCount()).toBe(2);
    expect(await s.stopAll("emergency")).toBe(2);
    expect(c.calls.every((ctx) => ctx.signal.aborted)).toBe(true);
    await cycle;
    expect(s.runningCount()).toBe(0);
  });

  it("TC-NOUS59_DEV-11 緊急停止の後 5 秒を過ぎても running の行は cancelled に直し、件数に入れる", async () => {
    const a = seedAgent(t.db, worldId, "minato");
    const stuckEvent = seedEvent(t.db, worldId, a);
    // abort を無視して終わらない runOpportunity
    const run = vi.fn(() => new Promise<OpportunityResult>(() => {}));
    const s = createScheduler(deps({ runOpportunity: run }));
    void s.runDueCycle();
    await flush();
    const stopping = s.stopAll("emergency");
    await flush();
    await clock.advance(EMERGENCY_WAIT_MS);
    expect(await stopping).toBe(1);
    const row = t.db.select().from(generation_events).where(eq(generation_events.event_id, stuckEvent)).get();
    expect(row).toMatchObject({ status: "cancelled", failure_kind: "cancelled" });
  });

  it("TC-NOUS59_DEV-12 runOpportunity が FreeTierExceededError を投げたら enterLimitStopped('free_tier_error')", async () => {
    seedAgent(t.db, worldId, "minato");
    const enter = vi.fn(async () => {});
    const run = vi.fn(async () => {
      throw new FreeTierExceededError("free tier", { httpStatus: 429 });
    });
    await createScheduler(deps({ runOpportunity: run, enterLimitStopped: enter })).runDueCycle();
    expect(enter).toHaveBeenCalledWith("free_tier_error");
  });

  it.each([
    ["TC-NOUS59_DEV-13", { neurons: 9500, runs: 0 }, "neurons_limit"],
    ["TC-NOUS59_DEV-14", { neurons: 0, runs: 480 }, "runs_limit"],
  ] as const)(
    "%s 行動機会の後に上限を超えていたら enterLimitStopped（%o → %s）し、次を割り当てない",
    async (_id, usage, reason) => {
      seedAgent(t.db, worldId, "minato");
      seedAgent(t.db, worldId, "haruka");
      setSettings({ max_concurrency: 1 });
      const enter = vi.fn(async () => {});
      const run = vi.fn(async () => {
        t.db
          .insert(daily_usage)
          .values({ usage_date: SEED_NOW.slice(0, 10), calls: 1, ...usage })
          .onConflictDoNothing()
          .run();
        return ok;
      });
      await createScheduler(deps({ runOpportunity: run, enterLimitStopped: enter })).runDueCycle();
      expect(enter).toHaveBeenCalledWith(reason);
      expect(run).toHaveBeenCalledTimes(1);
    },
  );

  it("TC-NOUS59_DEV-15 runOpportunity の想定外の例外は記録して巡を続ける", async () => {
    seedAgent(t.db, worldId, "minato");
    seedAgent(t.db, worldId, "haruka");
    setSettings({ max_concurrency: 1 });
    const run = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValue(ok);
    await createScheduler(deps({ runOpportunity: run })).runDueCycle();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("TC-NOUS59_DEV-16 runningCount は実行中の数を返し、stop で取り消して 0 になる", async () => {
    seedAgent(t.db, worldId, "minato");
    const c = controllableRun();
    const s = createScheduler(deps({ runOpportunity: c.run }));
    expect(s.runningCount()).toBe(0);
    s.start();
    await flush();
    expect(s.runningCount()).toBe(1);
    await s.stop();
    expect(s.runningCount()).toBe(0);
    expect(c.calls[0]?.signal.aborted).toBe(true);
  });

  it("TC-NOUS59_DEV-17 既定の enterLimitStopped は世界を limit_stopped（free_tier_error）にする", async () => {
    seedAgent(t.db, worldId, "minato");
    const run = vi.fn(async () => {
      throw new FreeTierExceededError("free tier", { httpStatus: 429 });
    });
    const d = deps({ runOpportunity: run });
    delete d.enterLimitStopped;
    await createScheduler(d).runDueCycle();
    expect(world()).toMatchObject({ state: "limit_stopped", stop_reason: "free_tier_error" });
  });

  it.each([
    ["TC-NOUS83_DEV-09", "pause"],
    ["TC-NOUS83_DEV-10", "limit"],
  ] as const)(
    "%s stopAll('%s') は実行中の行動機会の ctx.stopSignal を abort し ctx.signal は abort せずに 0 を返す",
    async (_id, mode) => {
      seedAgent(t.db, worldId, "minato");
      setSettings({ max_concurrency: 1 });
      const c = controllableRun();
      const s = createScheduler(deps({ runOpportunity: c.run }));
      const cycle = s.runDueCycle();
      await flush();

      expect(c.calls).toHaveLength(1);
      const ctx = c.calls[0]!;
      expect(ctx.stopSignal?.aborted).toBe(false);
      expect(ctx.signal.aborted).toBe(false);

      expect(await s.stopAll(mode)).toBe(0);
      expect(ctx.stopSignal?.aborted).toBe(true);
      expect(ctx.signal.aborted).toBe(false);

      c.releaseAll();
      await cycle;
    },
  );

  it("TC-NOUS83_DEV-11 stopAll('emergency') は実行中の行動機会の ctx.signal を abort し取り消した件数を返す", async () => {
    const a = seedAgent(t.db, worldId, "minato");
    setSettings({ max_concurrency: 1 });
    const c = controllableRun();
    const eventId = seedEvent(t.db, worldId, a);
    const run = vi.fn(async (ctx: OpportunityContext) => {
      try {
        return await c.run(ctx);
      } finally {
        t.db
          .update(generation_events)
          .set({ status: "cancelled", failure_kind: "cancelled", finished_at: clock.nowIso() })
          .where(eq(generation_events.event_id, eventId))
          .run();
      }
    });
    const s = createScheduler(deps({ runOpportunity: run }));
    const cycle = s.runDueCycle();
    await flush();

    expect(c.calls).toHaveLength(1);
    const ctx = c.calls[0]!;

    expect(await s.stopAll("emergency")).toBe(1);
    expect(ctx.signal.aborted).toBe(true);

    await cycle;
    expect(s.runningCount()).toBe(0);
  });

  it("TC-NOUS83_DEV-12 stopAll('pause') により再試行の待ちの途中の行動機会が時計を進めずに stopped で閉じる", async () => {
    seedAgent(t.db, worldId, "minato");
    setSettings({ max_concurrency: 1 });

    // 待ちを中断させるため、ctx.stopSignal を監視して待つモック
    let finishedStatus: OpportunityResult | null = null;
    const run = vi.fn(async (ctx: OpportunityContext): Promise<OpportunityResult> => {
      // 待ちの途中で stopSignal が abort されたら stopped で終了する（実際の runOpportunity の挙動のシミュレーション）
      await new Promise<void>((resolve) => {
        ctx.stopSignal?.addEventListener("abort", () => resolve(), { once: true });
      });
      finishedStatus = {
        eventId: "01J00000000000000000000000",
        status: "cancelled",
        action: null,
        decidedBy: "llm",
        neurons: 0,
        failureKind: "stopped",
      };
      return finishedStatus;
    });

    const s = createScheduler(deps({ runOpportunity: run }));
    const cycle = s.runDueCycle();
    await flush();

    expect(s.runningCount()).toBe(1);

    // 時計を進めずに stopAll("pause") を実行
    await s.stopAll("pause");
    await cycle;

    expect(finishedStatus).toMatchObject({
      status: "cancelled",
      failureKind: "stopped",
    });
    expect(s.runningCount()).toBe(0);
  });
});
