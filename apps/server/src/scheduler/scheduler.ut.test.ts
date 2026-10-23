// 単体テスト（NOUS-98）。観点表は docs/test/unit/NOUS-98/観点表_scheduler.json
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureLogger } from "../../test/helpers/adminTestSupport";
import { SEED_DATE, SEED_NOW, seedAgent, seedEvent, seedRunningWorld } from "../../test/helpers/generationSeed";
import { createTestDb, type TestDb } from "../../test/helpers/testDb";
import { FakeClock } from "../clock/fakeClock";
import type { GenerationConfig } from "../config/generationConfig";
import { daily_usage, generation_events, world_settings, worlds } from "../db/schema";
import type { OpportunityContext, OpportunityResult } from "../generation/opportunityRunner";
import { FreeTierExceededError, type LlmClient } from "../llm/llmClient";
import { createScheduler, ERROR_BACKOFF_MS, pickCount, shuffleBySeed, type SchedulerDeps } from "./scheduler";

const START = new Date(SEED_NOW);
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

/** release するまで終わらない runOpportunity。同時に動いた数の最大も数える */
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
  return { run, calls, releaseAll: () => releases.splice(0).forEach((r) => r()), maxRunning: () => maxRunning };
}

/** setImmediate を挟んで Promise の続きを流す */
const flush = async (times = 5): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise<void>((r) => setImmediate(r));
};

let t: TestDb;
let clock: FakeClock;
let worldId: string;

beforeEach(() => {
  t = createTestDb();
  clock = new FakeClock(START);
  worldId = seedRunningWorld(t.db);
});

afterEach(() => {
  t.cleanup();
});

function deps(over: Partial<SchedulerDeps> = {}): SchedulerDeps {
  return {
    db: t.db,
    clock,
    logger: captureLogger().logger,
    llm,
    config,
    llmMode: "fixed",
    random: () => 0.5,
    enterLimitStopped: vi.fn(async () => {}),
    runOpportunity: vi.fn(async () => ok),
    ...over,
  };
}

function setSettings(values: Partial<typeof world_settings.$inferInsert>): void {
  t.db.update(world_settings).set(values).where(eq(world_settings.world_id, worldId)).run();
}

function setWorld(values: Partial<typeof worlds.$inferInsert>): void {
  t.db.update(worlds).set(values).where(eq(worlds.world_id, worldId)).run();
}

function readWorld() {
  return t.db.select().from(worlds).where(eq(worlds.world_id, worldId)).get();
}

function setUsage(neurons: number, runs: number): void {
  t.db.insert(daily_usage).values({ usage_date: SEED_DATE, neurons, runs }).run();
}

describe("scheduler（単体テスト）", () => {
  it("TC-UT_SCH-001 next_cycle_at の 1 ミリ秒前は巡を始めず、ちょうどになると巡を始める", async () => {
    seedAgent(t.db, worldId, "minato");
    const next = new Date(START.getTime() + 60_000).toISOString();
    setWorld({ next_cycle_at: next });
    const run = vi.fn(async () => ok);
    const s = createScheduler(deps({ runOpportunity: run }));

    await clock.advance(60_000 - 1);
    const before = await s.runDueCycle();
    await clock.advance(1);
    const atDue = await s.runDueCycle();

    expect(before).toBe(false);
    expect(atDue).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("TC-UT_SCH-002 next_cycle_at が NULL の running の世界では、すぐに巡を始めて next_cycle_at を書く", async () => {
    seedAgent(t.db, worldId, "minato");
    setSettings({ cycle_minutes: 15 });
    const s = createScheduler(deps());

    const ran = await s.runDueCycle();

    expect(ran).toBe(true);
    expect(readWorld()?.next_cycle_at).toBe(new Date(START.getTime() + 15 * 60_000).toISOString());
  });

  it("TC-UT_SCH-003 現在の世界がないときは巡を始めず false を返す", async () => {
    setWorld({ state: "archived", running_since: null, archived_at: SEED_NOW });
    const run = vi.fn(async () => ok);
    const s = createScheduler(deps({ runOpportunity: run }));

    const ran = await s.runDueCycle();

    expect(ran).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it.each(["preparing", "limit_stopped", "emergency_stopped"] as const)(
    "TC-UT_SCH-004 世界が running でない状態では巡を始めず cycle_no も進めない（%s）",
    async (state) => {
      seedAgent(t.db, worldId, "minato");
      setWorld({ state, running_since: null });
      const run = vi.fn(async () => ok);
      const s = createScheduler(deps({ runOpportunity: run }));

      const ran = await s.runDueCycle();

      expect(ran).toBe(false);
      expect(run).not.toHaveBeenCalled();
      expect(readWorld()?.cycle_no).toBe(0);
    },
  );

  it("TC-UT_SCH-005 world_settings がない running の世界では runDueCycle が例外を投げる", async () => {
    t.db.delete(world_settings).where(eq(world_settings.world_id, worldId)).run();
    const s = createScheduler(deps());

    await expect(s.runDueCycle()).rejects.toThrow("world_settings がありません");
  });

  it("TC-UT_SCH-006 active のエージェントが 0 体でも巡は終わり、cycle_no と next_cycle_at を進める", async () => {
    seedAgent(t.db, worldId, "zen", { state: "stopped" });
    const run = vi.fn(async () => ok);
    const s = createScheduler(deps({ runOpportunity: run }));

    const ran = await s.runDueCycle();

    expect(ran).toBe(true);
    expect(run).not.toHaveBeenCalled();
    expect(readWorld()?.cycle_no).toBe(1);
    expect(readWorld()?.next_cycle_at).toBe(new Date(START.getTime() + 20 * 60_000).toISOString());
  });

  it("TC-UT_SCH-007 max_concurrency が対象の数より大きいときは、対象の数まで同時に実行する", async () => {
    seedAgent(t.db, worldId, "minato");
    seedAgent(t.db, worldId, "haruka");
    setSettings({ max_concurrency: 3 });
    const c = controllableRun();
    const s = createScheduler(deps({ runOpportunity: c.run }));

    const cycle = s.runDueCycle();
    await flush();
    const runningDuring = s.runningCount();
    c.releaseAll();
    await cycle;

    expect(runningDuring).toBe(2);
    expect(c.maxRunning()).toBe(2);
    expect(c.calls).toHaveLength(2);
  });

  it("TC-UT_SCH-008 巡の始めにその日の回数が上限ちょうどなら、1件も割り当てない", async () => {
    seedAgent(t.db, worldId, "minato");
    setSettings({ daily_runs_limit: 480 });
    setUsage(0, 480);
    const run = vi.fn(async () => ok);
    const enter = vi.fn(async () => {});
    const s = createScheduler(deps({ runOpportunity: run, enterLimitStopped: enter }));

    const ran = await s.runDueCycle();

    expect(ran).toBe(true);
    expect(run).not.toHaveBeenCalled();
  });

  it("TC-UT_SCH-009 行動機会の後のその日の利用が上限の 1 つ手前なら上限停止にせず、次の住人にも割り当てる", async () => {
    seedAgent(t.db, worldId, "minato");
    seedAgent(t.db, worldId, "haruka");
    setSettings({ daily_runs_limit: 480, daily_neurons_limit: 9500 });
    setUsage(9499, 479);
    const run = vi.fn(async () => ok);
    const enter = vi.fn(async () => {});
    const s = createScheduler(deps({ runOpportunity: run, enterLimitStopped: enter }));

    await s.runDueCycle();

    expect(enter).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it.each([
    [1, 10, 1],
    [10, 10, 1],
    [10, 11, 2],
    [10, 100, 10],
    [30, 100, 30],
    [0, 100, 0],
  ])(
    "TC-UT_SCH-010 pickCount は割合を切り上げ、1 体以上なら最低 1 体、体数を超えない（%i 体・%i%% → %i 体）",
    (total, percent, expected) => {
      const count = pickCount(total, percent);

      expect(count).toBe(expected);
    },
  );

  it("TC-UT_SCH-011 shuffleBySeed は空と 1 件の配列をそのまま返し、元の配列を書き換えない", () => {
    const items = Object.freeze(["a", "b", "c"]);

    const shuffled = shuffleBySeed(items, 7);

    expect(shuffleBySeed([], 7)).toEqual([]);
    expect(shuffleBySeed(["a"], 7)).toEqual(["a"]);
    expect([...shuffled].sort()).toEqual(["a", "b", "c"]);
    expect(items).toEqual(["a", "b", "c"]);
  });

  it("TC-UT_SCH-012 start を 2 回呼んでも loop は 1 つだけ動く", async () => {
    seedAgent(t.db, worldId, "minato");
    const run = vi.fn(async () => ok);
    const s = createScheduler(deps({ runOpportunity: run }));

    s.start();
    s.start();
    await flush();

    expect(run).toHaveBeenCalledTimes(1);
    await s.stop();
  });

  it("TC-UT_SCH-013 stop の後は start も wake も巡を始めない", async () => {
    seedAgent(t.db, worldId, "minato");
    const run = vi.fn(async () => ok);
    const s = createScheduler(deps({ runOpportunity: run }));

    await s.stop();
    s.start();
    s.wake();
    await flush();
    await clock.advance(60 * 60_000);

    expect(run).not.toHaveBeenCalled();
  });

  it("TC-UT_SCH-014 loop は next_cycle_at まで時計で待ち、1 ミリ秒前では始めず、ちょうどで次の巡を始める", async () => {
    seedAgent(t.db, worldId, "minato");
    setSettings({ cycle_minutes: 20 });
    const run = vi.fn(async () => ok);
    const s = createScheduler(deps({ runOpportunity: run }));

    s.start();
    await flush();
    await clock.advance(20 * 60_000 - 1);
    await flush();
    const callsBefore = run.mock.calls.length;
    await clock.advance(1);
    await flush();
    const callsAfter = run.mock.calls.length;
    await s.stop();

    expect(callsBefore).toBe(1);
    expect(callsAfter).toBe(2);
    expect(readWorld()?.cycle_no).toBe(2);
  });

  it("TC-UT_SCH-015 loop の想定外の例外は error を記録し、60 秒後に続ける", async () => {
    seedAgent(t.db, worldId, "minato");
    t.db.delete(world_settings).where(eq(world_settings.world_id, worldId)).run();
    const { logger, lines } = captureLogger();
    const run = vi.fn(async () => ok);
    const s = createScheduler(deps({ logger, runOpportunity: run }));

    s.start();
    await flush();
    const errors = lines().filter((l) => l.level === "error");
    t.db.insert(world_settings).values({ world_id: worldId, updated_at: SEED_NOW }).run();
    await clock.advance(ERROR_BACKOFF_MS - 1);
    await flush();
    const callsBefore = run.mock.calls.length;
    await clock.advance(1);
    await flush();
    await s.stop();

    expect(errors).toHaveLength(1);
    expect(callsBefore).toBe(0);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("TC-UT_SCH-016 stopAll('emergency') で実行中の行動機会がなく running の生成イベントもなければ、待たずに 0 を返す", async () => {
    const s = createScheduler(deps());

    const count = await s.stopAll("emergency");

    expect(count).toBe(0);
    expect(clock.pendingCount()).toBe(0);
  });

  it("TC-UT_SCH-017 stopAll('emergency') で実行中の行動機会がなくても、残っている running の生成イベントは cancelled にして数える", async () => {
    const agentId = seedAgent(t.db, worldId, "minato");
    const eventId = seedEvent(t.db, worldId, agentId);
    const s = createScheduler(deps());

    const count = await s.stopAll("emergency");

    expect(count).toBe(1);
    const row = t.db.select().from(generation_events).where(eq(generation_events.event_id, eventId)).get();
    expect(row).toMatchObject({ status: "cancelled", failure_kind: "cancelled", finished_at: SEED_NOW });
  });

  it("TC-UT_SCH-018 stopAll('pause') の後に世界が running のまま次の巡が来たら、停止の指示を下ろして割り当てを再開する", async () => {
    seedAgent(t.db, worldId, "minato");
    const run = vi.fn(async () => ok);
    const s = createScheduler(deps({ runOpportunity: run }));

    await s.stopAll("pause");
    const ran = await s.runDueCycle();

    expect(ran).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("TC-UT_SCH-019 FreeTierExceededError のときは free_tier_error の上限停止だけにし、続けて上限の理由で呼び直さない", async () => {
    seedAgent(t.db, worldId, "minato");
    setSettings({ daily_runs_limit: 480 });
    const enter = vi.fn(async () => {});
    // 巡の始めの確認は通すため、その日の回数は行動機会の中で上限にする
    const run = vi.fn(async () => {
      setUsage(0, 480);
      throw new FreeTierExceededError("free tier", { httpStatus: 429 });
    });
    const s = createScheduler(deps({ runOpportunity: run, enterLimitStopped: enter }));

    await s.runDueCycle();

    expect(enter).toHaveBeenCalledTimes(1);
    expect(enter).toHaveBeenCalledWith("free_tier_error");
  });

  it("TC-UT_SCH-020 行動機会の途中で世界が running でなくなると shouldContinue が false を返す", async () => {
    seedAgent(t.db, worldId, "minato");
    const c = controllableRun();
    const s = createScheduler(deps({ runOpportunity: c.run }));

    const cycle = s.runDueCycle();
    await flush();
    const ctx = c.calls[0] as OpportunityContext;
    const whileRunning = ctx.shouldContinue();
    setWorld({ state: "paused", running_since: null, stop_reason: "manual_pause" });
    const afterPause = ctx.shouldContinue();
    c.releaseAll();
    await cycle;

    expect(whileRunning).toBe(true);
    expect(afterPause).toBe(false);
  });

  it("TC-UT_SCH-021 1 巡の全員に、random から作った同じ cycleSeed と同じ cycleNo を渡す", async () => {
    seedAgent(t.db, worldId, "minato");
    seedAgent(t.db, worldId, "haruka");
    const run = vi.fn<(ctx: OpportunityContext) => Promise<OpportunityResult>>(async () => ok);
    const s = createScheduler(deps({ runOpportunity: run, random: () => 0.25 }));

    await s.runDueCycle();

    const seeds = run.mock.calls.map(([ctx]) => ctx.cycleSeed);
    const cycleNos = run.mock.calls.map(([ctx]) => ctx.cycleNo);
    expect(seeds).toEqual([2 ** 30, 2 ** 30]);
    expect(cycleNos).toEqual([1, 1]);
  });

  it("TC-UT_SCH-022 巡の途中（loop が待っていないとき）に wake されても、次の巡は next_cycle_at まで始めない", async () => {
    seedAgent(t.db, worldId, "minato");
    const c = controllableRun();
    const s = createScheduler(deps({ runOpportunity: c.run }));

    s.start();
    await flush();
    s.wake();
    c.releaseAll();
    await flush();
    const callsAfterWake = c.calls.length;
    await clock.advance(20 * 60_000);
    await flush();
    const callsAtNext = c.calls.length;
    c.releaseAll();
    await s.stop();

    expect(callsAfterWake).toBe(1);
    expect(callsAtNext).toBe(2);
  });

  it("TC-UT_SCH-023 現在の世界がないときの stopAll('emergency') は、生成イベントを読まずに 0 を返す", async () => {
    const agentId = seedAgent(t.db, worldId, "minato");
    const eventId = seedEvent(t.db, worldId, agentId);
    setWorld({ state: "archived", running_since: null, archived_at: SEED_NOW });
    const s = createScheduler(deps());

    const count = await s.stopAll("emergency");

    expect(count).toBe(0);
    const row = t.db.select().from(generation_events).where(eq(generation_events.event_id, eventId)).get();
    expect(row?.status).toBe("running");
  });
});
