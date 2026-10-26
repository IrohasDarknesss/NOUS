// 単体テスト（NOUS-97）。観点表は docs/test/unit/NOUS-97/観点表_worldService.json
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureLogger } from "../../test/helpers/adminTestSupport";
import { createTestDb, type TestDb } from "../../test/helpers/testDb";
import { FakeClock } from "../clock/fakeClock";
import { agents, daily_usage, generation_events, memories, world_settings, worlds } from "../db/schema";
import { withTx } from "../db/tx";
import { AppError } from "../lib/errors";
import { newUlid } from "../lib/ids";
import {
  countRunningEvents,
  createInitialWorld,
  createWorldService,
  findCurrentWorld,
  getUsage,
  nextWorldName,
  type AuditEntry,
  type SchedulerControl,
  type WorldRow,
} from "./worldService";

const START = new Date("2026-10-22T00:00:00.000Z");
const ADMIN = { adminId: "01JADMIN00000000000000000A" };

let t: TestDb;
let clock: FakeClock;
let audits: AuditEntry[];
let log: ReturnType<typeof captureLogger>;
let scheduler: SchedulerControl & { stopAll: ReturnType<typeof vi.fn>; wake: ReturnType<typeof vi.fn> };

function service() {
  return createWorldService({
    db: t.db,
    clock,
    scheduler,
    recordAudit: (_tx, entry) => audits.push(entry),
    logger: log.logger,
  });
}

function seedWorld(): WorldRow {
  return withTx(t.db, (tx) => createInitialWorld(tx, clock.now()));
}

function addAgent(
  worldId: string,
  handle: string,
  opts: { state?: "active" | "stopped"; memory?: boolean; text?: string } = {},
): string {
  const agentId = newUlid();
  const iso = clock.nowIso();
  const text = opts.text ?? "星";
  t.db
    .insert(agents)
    .values({
      agent_id: agentId,
      world_id: worldId,
      handle,
      display_name: handle,
      interests: text,
      topics: text,
      personality: "穏やか",
      values_text: text,
      stance: "中立",
      state: opts.state ?? "active",
      created_at: iso,
      updated_at: iso,
    })
    .run();
  if (opts.memory ?? true) {
    t.db
      .insert(memories)
      .values({
        memory_id: newUlid(),
        agent_id: agentId,
        kind: "interest_profile",
        content: `${handle} の興味`,
        updated_at: iso,
      })
      .run();
  }
  return agentId;
}

function addRunningEvent(worldId: string, agentId: string, status: "running" | "succeeded" = "running"): void {
  t.db
    .insert(generation_events)
    .values({
      event_id: newUlid(),
      world_id: worldId,
      agent_id: agentId,
      cycle_no: 1,
      cycle_seed: 1,
      world_time_sec: 0,
      usage_date: "2026-10-22",
      status,
      decided_by: "llm",
      model_id: "@cf/google/gemma-4-26b-a4b-it",
      prompt_version: "v1",
      llm_mode: "fixed",
      started_at: clock.nowIso(),
      finished_at: status === "running" ? null : clock.nowIso(),
    })
    .run();
}

function setUsage(neurons: number, runs: number): void {
  t.db
    .insert(daily_usage)
    .values({ usage_date: "2026-10-22", neurons, runs })
    .onConflictDoUpdate({ target: daily_usage.usage_date, set: { neurons, runs } })
    .run();
}

function current(): WorldRow {
  return findCurrentWorld(t.db)!;
}

function setState(worldId: string, values: Partial<WorldRow>): void {
  t.db.update(worlds).set(values).where(eq(worlds.world_id, worldId)).run();
}

function archive(worldId: string): void {
  setState(worldId, { state: "archived", archived_at: clock.nowIso(), running_since: null });
}

function expectAppError(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe(code);
    return;
  }
  throw new Error(`${code} が投げられませんでした`);
}

/** 準備中の世界とエージェント1体を作り、開始して running にする */
function runningWorld(): WorldRow {
  const world = seedWorld();
  addAgent(world.world_id, "alice");
  service().startWorld(ADMIN);
  return current();
}

beforeEach(() => {
  t = createTestDb();
  clock = new FakeClock(START);
  audits = [];
  log = captureLogger();
  scheduler = { stopAll: vi.fn(async () => 0), wake: vi.fn() };
});

afterEach(() => {
  t.cleanup();
});

describe("worldService の読み取り（単体テスト）", () => {
  it("TC-UT_WLD-015 findCurrentWorld は archived の世界を返さない（archived だけなら undefined）", () => {
    const world = seedWorld();
    archive(world.world_id);

    const found = findCurrentWorld(t.db);

    expect(found).toBeUndefined();
  });

  it("TC-UT_WLD-016 getUsage は利用日の行がなければ neurons 0・runs 0 を返す", () => {
    const usage = getUsage(t.db, "2026-10-22");

    expect(usage).toEqual({ neurons: 0, runs: 0 });
  });

  it("TC-UT_WLD-017 countRunningEvents は同じ世界の status=running だけを数える", () => {
    const old = seedWorld();
    const oldAgent = addAgent(old.world_id, "old");
    addRunningEvent(old.world_id, oldAgent);
    archive(old.world_id);
    const world = seedWorld();
    const agentId = addAgent(world.world_id, "alice");
    addRunningEvent(world.world_id, agentId);
    addRunningEvent(world.world_id, agentId);
    addRunningEvent(world.world_id, agentId, "succeeded");

    const n = countRunningEvents(t.db, world.world_id);

    expect(n).toBe(2);
  });

  it("TC-UT_WLD-018 nextWorldName は番号に欠けがあれば小さい番号から使う", () => {
    const a = seedWorld();
    archive(a.world_id);
    const b = withTx(t.db, (tx) => {
      tx.insert(worlds)
        .values({
          world_id: newUlid(),
          name: "世界 2026-10-22-3",
          state: "archived",
          archived_at: clock.nowIso(),
          created_at: clock.nowIso(),
        })
        .run();
      return nextWorldName(tx, "2026-10-22");
    });

    expect(b).toBe("世界 2026-10-22-2");
  });

  it("TC-UT_WLD-019 nextWorldName は別の日付の世界を数えない", () => {
    const world = seedWorld();
    archive(world.world_id);

    const name = nextWorldName(t.db, "2026-10-23");

    expect(name).toBe("世界 2026-10-23");
  });
});

describe("startWorld（単体テスト）", () => {
  it("TC-UT_WLD-020 現在の世界がなければ STATE_CONFLICT", () => {
    expectAppError(() => service().startWorld(ADMIN), "STATE_CONFLICT");

    expect(audits).toHaveLength(0);
    expect(scheduler.wake).not.toHaveBeenCalled();
  });

  it("TC-UT_WLD-021 実行回数が上限に達していれば preparing → limit_stopped（runs_limit）にし、started_at を入れて監査を残す", () => {
    const world = seedWorld();
    addAgent(world.world_id, "alice");
    setUsage(0, 480);

    const res = service().startWorld(ADMIN);

    expect(res).toEqual({ state: "limit_stopped", startedAt: START.toISOString() });
    expect(current()).toMatchObject({
      state: "limit_stopped",
      stop_reason: "runs_limit",
      started_at: START.toISOString(),
      running_since: null,
      world_elapsed_sec: 0,
    });
    expect(audits[0]).toMatchObject({
      operation: "world.start",
      before: { state: "preparing" },
      after: { state: "limit_stopped" },
    });
    expect(scheduler.wake).not.toHaveBeenCalled();
  });

  it("TC-UT_WLD-022 ほかの世界の active のエージェントは数えず、NO_AGENTS にする", () => {
    const old = seedWorld();
    addAgent(old.world_id, "old");
    archive(old.world_id);
    seedWorld();

    expectAppError(() => service().startWorld(ADMIN), "NO_AGENTS");
  });
});

describe("pauseWorld（単体テスト）", () => {
  it("TC-UT_WLD-023 runningGenerations に、その世界の実行中の生成の数を返す", () => {
    const world = runningWorld();
    const agentId = t.db.select().from(agents).where(eq(agents.world_id, world.world_id)).get()!.agent_id;
    addRunningEvent(world.world_id, agentId);

    const res = service().pauseWorld(ADMIN);

    expect(res.runningGenerations).toBe(1);
  });

  it("TC-UT_WLD-024 stopAll('pause') が失敗しても一時停止は成功し、error のログを出す", async () => {
    runningWorld();
    scheduler.stopAll.mockRejectedValueOnce(new Error("boom"));

    const res = service().pauseWorld(ADMIN);
    await clock.advance(0);

    expect(res.state).toBe("paused");
    expect(current().state).toBe("paused");
    expect(log.lines().some((l) => l.level === "error")).toBe(true);
  });

  it("TC-UT_WLD-025 limit_stopped からの一時停止で stop_reason を manual_pause にし、監査の before は limit_stopped", () => {
    const world = seedWorld();
    addAgent(world.world_id, "alice");
    setUsage(9500, 0);
    service().startWorld(ADMIN);

    service().pauseWorld(ADMIN);

    expect(current()).toMatchObject({ state: "paused", stop_reason: "manual_pause" });
    expect(audits.at(-1)).toMatchObject({
      operation: "world.pause",
      before: { state: "limit_stopped" },
      after: { state: "paused" },
    });
  });
});

describe("resumeWorld（単体テスト）", () => {
  it("TC-UT_WLD-026 paused から再開したが Neurons が上限なら paused → limit_stopped（neurons_limit）にし、wake しない", () => {
    runningWorld();
    service().pauseWorld(ADMIN);
    scheduler.wake.mockClear();
    setUsage(9500, 0);

    const res = service().resumeWorld(ADMIN);

    expect(res).toEqual({ state: "limit_stopped", stopReason: "neurons_limit" });
    expect(current()).toMatchObject({ state: "limit_stopped", stop_reason: "neurons_limit", running_since: null });
    expect(scheduler.wake).not.toHaveBeenCalled();
  });

  it("TC-UT_WLD-027 emergency_stopped から再開すると running にし、止まっていた間は世界内時間に数えない", async () => {
    runningWorld();
    await clock.advance(30_000);
    await service().emergencyStopWorld(ADMIN);
    await clock.advance(600_000);
    scheduler.wake.mockClear();

    const res = service().resumeWorld(ADMIN);
    await clock.advance(10_000);

    expect(res).toEqual({ state: "running", stopReason: null });
    expect(current()).toMatchObject({
      state: "running",
      stop_reason: null,
      running_since: "2026-10-22T00:10:30.000Z",
      heartbeat_at: "2026-10-22T00:10:30.000Z",
    });
    expect(current().world_elapsed_sec).toBe(30);
    expect(scheduler.wake).toHaveBeenCalledTimes(1);
  });

  it("TC-UT_WLD-028 再開の監査の before・after に state と stopReason を残す", () => {
    runningWorld();
    service().pauseWorld(ADMIN);

    service().resumeWorld(ADMIN);

    expect(audits.at(-1)).toMatchObject({
      operation: "world.resume",
      before: { state: "paused", stopReason: "manual_pause" },
      after: { state: "running", stopReason: null },
    });
  });

  it("TC-UT_WLD-029 next_cycle_at が null なら、再開した時刻を next_cycle_at にする", async () => {
    const world = runningWorld();
    service().pauseWorld(ADMIN);
    setState(world.world_id, { next_cycle_at: null });
    await clock.advance(5_000);

    service().resumeWorld(ADMIN);

    expect(current().next_cycle_at).toBe(clock.nowIso());
  });
});

describe("emergencyStopWorld（単体テスト）", () => {
  it("TC-UT_WLD-030 paused から緊急停止すると世界内時間は変えず、stop_reason を emergency にする", async () => {
    runningWorld();
    await clock.advance(20_000);
    service().pauseWorld(ADMIN);
    await clock.advance(60_000);

    const res = await service().emergencyStopWorld(ADMIN);

    expect(res.state).toBe("emergency_stopped");
    expect(current()).toMatchObject({
      state: "emergency_stopped",
      stop_reason: "emergency",
      world_elapsed_sec: 20,
      running_since: null,
    });
    expect(audits.at(-1)).toMatchObject({ operation: "world.emergency_stop", before: { state: "paused" } });
    expect(scheduler.stopAll).toHaveBeenLastCalledWith("emergency");
  });

  it("TC-UT_WLD-031 limit_stopped から緊急停止できる", async () => {
    const world = seedWorld();
    addAgent(world.world_id, "alice");
    setUsage(0, 480);
    service().startWorld(ADMIN);

    const res = await service().emergencyStopWorld(ADMIN);

    expect(res.state).toBe("emergency_stopped");
    expect(current()).toMatchObject({ state: "emergency_stopped", stop_reason: "emergency" });
  });
});

describe("resetWorld（単体テスト）", () => {
  it.each([["limit_stopped"], ["emergency_stopped"]] as const)(
    "TC-UT_WLD-032 limit_stopped・emergency_stopped の世界もリセットでき、archived にする（%j）",
    (state) => {
      const world = runningWorld();
      service().pauseWorld(ADMIN);
      setState(world.world_id, { state, stop_reason: state === "limit_stopped" ? "runs_limit" : "emergency" });

      const res = service().resetWorld(ADMIN, "世界 2026-10-22");

      const old = t.db.select().from(worlds).where(eq(worlds.world_id, world.world_id)).get()!;
      expect(old).toMatchObject({ state: "archived", archived_at: START.toISOString() });
      expect(current()).toMatchObject({ world_id: res.newWorldId, state: "preparing" });
    },
  );

  it("TC-UT_WLD-033 旧の記憶がないエージェントは、interest_profile を「興味・関心・大事にしていること」の1文で 200 字までにして作る", () => {
    const world = seedWorld();
    addAgent(world.world_id, "alice", { memory: false, text: "あ".repeat(100) });
    service().startWorld(ADMIN);
    service().pauseWorld(ADMIN);

    const res = service().resetWorld(ADMIN, "世界 2026-10-22");

    const copied = t.db.select().from(agents).where(eq(agents.world_id, res.newWorldId)).get()!;
    const memory = t.db.select().from(memories).where(eq(memories.agent_id, copied.agent_id)).get()!;
    expect(memory.kind).toBe("interest_profile");
    expect(memory.content.startsWith(`興味：${"あ".repeat(100)}。関心：`)).toBe(true);
    expect(memory.content).toHaveLength(200);
  });

  it("TC-UT_WLD-034 新しい世界は世界内時間 0・巡 0 で始まり、world_settings の全項目を写し、daily_usage は変えない", () => {
    const world = runningWorld();
    t.db
      .update(world_settings)
      .set({
        cycle_minutes: 45,
        activity_percent: 50,
        max_ref_posts: 5,
        daily_neurons_limit: 8000,
        daily_runs_limit: 300,
        max_concurrency: 2,
      })
      .where(eq(world_settings.world_id, world.world_id))
      .run();
    setState(world.world_id, { cycle_no: 7 });
    setUsage(1234.5, 67);
    service().pauseWorld(ADMIN);

    const res = service().resetWorld(ADMIN, "世界 2026-10-22");

    const oldSettings = t.db.select().from(world_settings).where(eq(world_settings.world_id, world.world_id)).get()!;
    const newSettings = t.db.select().from(world_settings).where(eq(world_settings.world_id, res.newWorldId)).get()!;
    const values = (row: typeof oldSettings) => ({ ...row, world_id: "", updated_at: "" });
    expect(values(newSettings)).toEqual(values(oldSettings));
    expect(current()).toMatchObject({
      world_elapsed_sec: 0,
      cycle_no: 0,
      running_since: null,
      started_at: null,
      stop_reason: null,
    });
    expect(getUsage(t.db, "2026-10-22")).toEqual({ neurons: 1234.5, runs: 67 });
  });

  it("TC-UT_WLD-035 リセットの監査は、旧の世界の world_id を targetId と worldId にする", () => {
    const world = runningWorld();
    service().pauseWorld(ADMIN);

    service().resetWorld(ADMIN, "世界 2026-10-22");

    expect(audits.at(-1)).toMatchObject({
      operation: "world.reset",
      targetType: "world",
      targetId: world.world_id,
      worldId: world.world_id,
    });
  });

  it("TC-UT_WLD-036 確認の名前が違うときは、世界・設定・エージェント・監査のどれも増やさない", () => {
    const world = runningWorld();
    service().pauseWorld(ADMIN);
    const auditCount = audits.length;

    expectAppError(() => service().resetWorld(ADMIN, "世界 2026-10-22 "), "CONFIRM_MISMATCH");

    expect(t.db.select().from(worlds).all()).toHaveLength(1);
    expect(t.db.select().from(world_settings).all()).toHaveLength(1);
    expect(t.db.select().from(agents).all()).toHaveLength(1);
    expect(audits).toHaveLength(auditCount);
    expect(current()).toMatchObject({ world_id: world.world_id, state: "paused" });
  });
});

describe("enterLimitStopped（単体テスト）", () => {
  it("TC-UT_WLD-037 現在の世界がなければ何もしない", async () => {
    await service().enterLimitStopped("neurons_limit");

    expect(t.db.select().from(worlds).all()).toHaveLength(0);
    expect(scheduler.stopAll).not.toHaveBeenCalled();
  });

  it("TC-UT_WLD-038 すでに limit_stopped なら stop_reason を変えず、stopAll も呼ばない", async () => {
    const world = seedWorld();
    addAgent(world.world_id, "alice");
    setUsage(0, 480);
    service().startWorld(ADMIN);

    await service().enterLimitStopped("free_tier_error");

    expect(current()).toMatchObject({ state: "limit_stopped", stop_reason: "runs_limit" });
    expect(scheduler.stopAll).not.toHaveBeenCalled();
  });

  it.each([["neurons_limit"], ["runs_limit"]] as const)(
    "TC-UT_WLD-039 running なら上限の理由（neurons_limit・runs_limit）で running → limit_stopped にする（%j）",
    async (reason) => {
      runningWorld();
      await clock.advance(5_000);

      await service().enterLimitStopped(reason);

      expect(current()).toMatchObject({
        state: "limit_stopped",
        stop_reason: reason,
        world_elapsed_sec: 5,
        running_since: null,
      });
      expect(scheduler.stopAll).toHaveBeenCalledWith("limit");
    },
  );
});
