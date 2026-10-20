import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, type TestDb } from "../../test/helpers/testDb";
import { FakeClock } from "../clock/fakeClock";
import { agents, daily_usage, generation_events, memories, world_settings, worlds } from "../db/schema";
import { withTx } from "../db/tx";
import { AppError } from "../lib/errors";
import { newUlid } from "../lib/ids";
import {
  createInitialWorld,
  createWorldService,
  findCurrentWorld,
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
let scheduler: SchedulerControl & { stopAll: ReturnType<typeof vi.fn>; wake: ReturnType<typeof vi.fn> };

function service() {
  return createWorldService({
    db: t.db,
    clock,
    scheduler,
    recordAudit: (_tx, entry) => audits.push(entry),
  });
}

function seedWorld(): WorldRow {
  return withTx(t.db, (tx) => createInitialWorld(tx, clock.now()));
}

function addAgent(worldId: string, handle: string, state: "active" | "stopped" = "active"): string {
  const agentId = newUlid();
  const iso = clock.nowIso();
  t.db
    .insert(agents)
    .values({
      agent_id: agentId,
      world_id: worldId,
      handle,
      display_name: handle,
      interests: "星",
      topics: "宇宙",
      personality: "穏やか",
      values_text: "誠実",
      stance: "中立",
      state,
      created_at: iso,
      updated_at: iso,
    })
    .run();
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
  return agentId;
}

function setUsage(neurons: number, runs: number): void {
  t.db.insert(daily_usage).values({ usage_date: "2026-10-22", neurons, runs }).run();
}

function current(): WorldRow {
  return findCurrentWorld(t.db)!;
}

function setState(worldId: string, values: Partial<WorldRow>): void {
  t.db.update(worlds).set(values).where(eq(worlds.world_id, worldId)).run();
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

beforeEach(() => {
  t = createTestDb();
  clock = new FakeClock(START);
  audits = [];
  scheduler = { stopAll: vi.fn(async () => 0), wake: vi.fn() };
});

afterEach(() => {
  t.cleanup();
});

describe("createInitialWorld・nextWorldName", () => {
  it("TC-NOUS57_DEV-15 準備中の世界と既定の world_settings を作る", () => {
    const world = seedWorld();
    expect(world.state).toBe("preparing");
    expect(world.name).toBe("世界 2026-10-22");
    const settings = t.db.select().from(world_settings).where(eq(world_settings.world_id, world.world_id)).get();
    expect(settings?.daily_neurons_limit).toBe(9500);
    expect(settings?.daily_runs_limit).toBe(480);
  });

  it("TC-NOUS57_DEV-16 同名の世界があれば -2、-3 と番号を足す", () => {
    const world = seedWorld();
    setState(world.world_id, { state: "archived", archived_at: clock.nowIso() });
    expect(nextWorldName(t.db, "2026-10-22")).toBe("世界 2026-10-22-2");
    seedWorld();
    setState(current().world_id, { state: "archived", archived_at: clock.nowIso() });
    expect(nextWorldName(t.db, "2026-10-22")).toBe("世界 2026-10-22-3");
  });
});

describe("startWorld", () => {
  it("TC-NOUS57_DEV-17 準備中で上限の中なら running にし、監査を残して wake する", () => {
    const world = seedWorld();
    addAgent(world.world_id, "alice");
    const res = service().startWorld(ADMIN);
    expect(res).toEqual({ state: "running", startedAt: START.toISOString() });
    const row = current();
    expect(row.running_since).toBe(START.toISOString());
    expect(row.heartbeat_at).toBe(START.toISOString());
    expect(row.next_cycle_at).toBe(START.toISOString());
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      operation: "world.start",
      before: { state: "preparing" },
      after: { state: "running" },
    });
    expect(scheduler.wake).toHaveBeenCalledTimes(1);
  });

  it("TC-NOUS57_DEV-18 上限に達していれば limit_stopped と理由（wake しない）", () => {
    const world = seedWorld();
    addAgent(world.world_id, "alice");
    setUsage(9500, 0);
    expect(service().startWorld(ADMIN).state).toBe("limit_stopped");
    expect(current().stop_reason).toBe("neurons_limit");
    expect(current().running_since).toBeNull();
    expect(scheduler.wake).not.toHaveBeenCalled();
  });

  it("TC-NOUS57_DEV-19 active のエージェントが0体なら NO_AGENTS", () => {
    const world = seedWorld();
    addAgent(world.world_id, "alice", "stopped");
    expectAppError(() => service().startWorld(ADMIN), "NO_AGENTS");
    expect(current().state).toBe("preparing");
    expect(audits).toHaveLength(0);
  });

  it("TC-NOUS57_DEV-20 準備中以外なら STATE_CONFLICT", () => {
    const world = seedWorld();
    addAgent(world.world_id, "alice");
    service().startWorld(ADMIN);
    expectAppError(() => service().startWorld(ADMIN), "STATE_CONFLICT");
  });
});

describe("pauseWorld", () => {
  it("TC-NOUS57_DEV-21 running から一時停止し、世界内時間を確定して stopAll('pause') を呼ぶ", async () => {
    const world = seedWorld();
    addAgent(world.world_id, "alice");
    service().startWorld(ADMIN);
    await clock.advance(90_500);
    const res = service().pauseWorld(ADMIN);
    expect(res).toEqual({ state: "paused", worldTimeSec: 90, runningGenerations: 0 });
    const row = current();
    expect(row.world_elapsed_sec).toBe(90);
    expect(row.running_since).toBeNull();
    expect(row.stop_reason).toBe("manual_pause");
    expect(scheduler.stopAll).toHaveBeenCalledWith("pause");
  });

  it("TC-NOUS57_DEV-22 limit_stopped からも一時停止でき、世界内時間は変わらない", () => {
    const world = seedWorld();
    addAgent(world.world_id, "alice");
    setUsage(0, 480);
    service().startWorld(ADMIN);
    expect(service().pauseWorld(ADMIN).worldTimeSec).toBe(0);
    expect(current().state).toBe("paused");
  });

  it("TC-NOUS57_DEV-23 preparing・paused・emergency_stopped からは STATE_CONFLICT", async () => {
    const world = seedWorld();
    addAgent(world.world_id, "alice");
    expectAppError(() => service().pauseWorld(ADMIN), "STATE_CONFLICT");
    service().startWorld(ADMIN);
    service().pauseWorld(ADMIN);
    expectAppError(() => service().pauseWorld(ADMIN), "STATE_CONFLICT");
    await service().emergencyStopWorld(ADMIN);
    expectAppError(() => service().pauseWorld(ADMIN), "STATE_CONFLICT");
  });
});

describe("resumeWorld", () => {
  it("TC-NOUS57_DEV-24 paused から再開し、next_cycle_at は max(現在, 既存の予定)", async () => {
    const world = seedWorld();
    addAgent(world.world_id, "alice");
    service().startWorld(ADMIN);
    service().pauseWorld(ADMIN);
    const planned = "2026-10-22T00:20:00.000Z";
    setState(world.world_id, { next_cycle_at: planned });
    await clock.advance(60_000);
    expect(service().resumeWorld(ADMIN)).toEqual({ state: "running", stopReason: null });
    expect(current().next_cycle_at).toBe(planned);
    expect(current().running_since).toBe(clock.nowIso());
    expect(scheduler.wake).toHaveBeenCalledTimes(2);

    service().pauseWorld(ADMIN);
    await clock.advance(60 * 60_000);
    service().resumeWorld(ADMIN);
    expect(current().next_cycle_at).toBe(clock.nowIso());
  });

  it("TC-NOUS57_DEV-25 上限に達していれば limit_stopped と理由", async () => {
    const world = seedWorld();
    addAgent(world.world_id, "alice");
    service().startWorld(ADMIN);
    await service().emergencyStopWorld(ADMIN);
    setUsage(0, 480);
    expect(service().resumeWorld(ADMIN)).toEqual({ state: "limit_stopped", stopReason: "runs_limit" });
    expect(current().running_since).toBeNull();
  });

  it("TC-NOUS57_DEV-26 preparing・running・limit_stopped からは STATE_CONFLICT", () => {
    const world = seedWorld();
    addAgent(world.world_id, "alice");
    expectAppError(() => service().resumeWorld(ADMIN), "STATE_CONFLICT");
    service().startWorld(ADMIN);
    expectAppError(() => service().resumeWorld(ADMIN), "STATE_CONFLICT");
    setState(world.world_id, { state: "limit_stopped", running_since: null, stop_reason: "runs_limit" });
    expectAppError(() => service().resumeWorld(ADMIN), "STATE_CONFLICT");
  });
});

describe("emergencyStopWorld", () => {
  it("TC-NOUS57_DEV-27 running から緊急停止し、世界内時間を確定して取り消した件数を返す", async () => {
    const world = seedWorld();
    addAgent(world.world_id, "alice");
    service().startWorld(ADMIN);
    await clock.advance(30_000);
    scheduler.stopAll.mockResolvedValueOnce(2);
    expect(await service().emergencyStopWorld(ADMIN)).toEqual({ state: "emergency_stopped", cancelledGenerations: 2 });
    expect(current().world_elapsed_sec).toBe(30);
    expect(current().stop_reason).toBe("emergency");
    expect(scheduler.stopAll).toHaveBeenCalledWith("emergency");
  });

  it("TC-NOUS57_DEV-28 preparing・emergency_stopped からは STATE_CONFLICT", async () => {
    const world = seedWorld();
    addAgent(world.world_id, "alice");
    await expect(service().emergencyStopWorld(ADMIN)).rejects.toMatchObject({ code: "STATE_CONFLICT" });
    service().startWorld(ADMIN);
    await service().emergencyStopWorld(ADMIN);
    await expect(service().emergencyStopWorld(ADMIN)).rejects.toMatchObject({ code: "STATE_CONFLICT" });
  });
});

describe("resetWorld", () => {
  it("TC-NOUS57_DEV-29 一時停止の世界をアーカイブにし、設定とエージェントを写した準備中の世界を作る", () => {
    const world = seedWorld();
    addAgent(world.world_id, "alice");
    addAgent(world.world_id, "bob", "stopped");
    t.db.update(world_settings).set({ cycle_minutes: 30 }).where(eq(world_settings.world_id, world.world_id)).run();
    service().startWorld(ADMIN);
    service().pauseWorld(ADMIN);

    const res = service().resetWorld(ADMIN, "世界 2026-10-22");
    expect(res.archivedWorldId).toBe(world.world_id);
    expect(res.state).toBe("preparing");
    const archived = t.db.select().from(worlds).where(eq(worlds.world_id, world.world_id)).get()!;
    expect(archived.state).toBe("archived");
    expect(archived.archived_at).toBe(START.toISOString());

    const next = current();
    expect(next.world_id).toBe(res.newWorldId);
    expect(next.name).toBe("世界 2026-10-22-2");
    const settings = t.db.select().from(world_settings).where(eq(world_settings.world_id, next.world_id)).get();
    expect(settings?.cycle_minutes).toBe(30);

    const copied = t.db.select().from(agents).where(eq(agents.world_id, next.world_id)).all();
    expect(copied.map((a) => [a.handle, a.state]).sort()).toEqual([
      ["alice", "active"],
      ["bob", "active"],
    ]);
    for (const a of copied) {
      const m = t.db.select().from(memories).where(eq(memories.agent_id, a.agent_id)).all();
      expect(m.map((r) => [r.kind, r.content])).toEqual([["interest_profile", `${a.handle} の興味`]]);
    }
    expect(audits.at(-1)).toMatchObject({
      operation: "world.reset",
      before: { worldId: world.world_id },
      after: { worldId: res.newWorldId },
    });
  });

  it("TC-NOUS57_DEV-30 準備中・稼働はリセットできない（STATE_CONFLICT）", () => {
    const world = seedWorld();
    addAgent(world.world_id, "alice");
    expectAppError(() => service().resetWorld(ADMIN, "世界 2026-10-22"), "STATE_CONFLICT");
    service().startWorld(ADMIN);
    expectAppError(() => service().resetWorld(ADMIN, "世界 2026-10-22"), "STATE_CONFLICT");
    expect(current().world_id).toBe(world.world_id);
  });

  it("TC-NOUS57_DEV-31 confirmName が違えば CONFIRM_MISMATCH", () => {
    const world = seedWorld();
    addAgent(world.world_id, "alice");
    service().startWorld(ADMIN);
    service().pauseWorld(ADMIN);
    expectAppError(() => service().resetWorld(ADMIN, "世界 2026-10-21"), "CONFIRM_MISMATCH");
    expect(current().state).toBe("paused");
  });

  it("TC-NOUS57_DEV-32 実行中の生成が残っていれば GENERATION_RUNNING", () => {
    const world = seedWorld();
    const agentId = addAgent(world.world_id, "alice");
    service().startWorld(ADMIN);
    service().pauseWorld(ADMIN);
    t.db
      .insert(generation_events)
      .values({
        event_id: newUlid(),
        world_id: world.world_id,
        agent_id: agentId,
        cycle_no: 1,
        cycle_seed: 1,
        world_time_sec: 0,
        usage_date: "2026-10-22",
        status: "running",
        decided_by: "llm",
        model_id: "@cf/google/gemma-4-26b-a4b-it",
        prompt_version: "v1",
        llm_mode: "fixed",
        started_at: clock.nowIso(),
      })
      .run();
    expectAppError(() => service().resetWorld(ADMIN, "世界 2026-10-22"), "GENERATION_RUNNING");
  });
});

describe("enterLimitStopped", () => {
  it("TC-NOUS57_DEV-33 running なら世界内時間を確定して limit_stopped にし、stopAll('limit') を呼ぶ（監査なし）", async () => {
    const world = seedWorld();
    addAgent(world.world_id, "alice");
    service().startWorld(ADMIN);
    await clock.advance(10_000);
    await service().enterLimitStopped("free_tier_error");
    expect(current()).toMatchObject({ state: "limit_stopped", stop_reason: "free_tier_error", world_elapsed_sec: 10 });
    expect(scheduler.stopAll).toHaveBeenCalledWith("limit");
    expect(audits).toHaveLength(1);
  });

  it("TC-NOUS57_DEV-34 running でなければ何もしない", async () => {
    const world = seedWorld();
    addAgent(world.world_id, "alice");
    service().startWorld(ADMIN);
    service().pauseWorld(ADMIN);
    scheduler.stopAll.mockClear();
    await service().enterLimitStopped("neurons_limit");
    expect(current().state).toBe("paused");
    expect(scheduler.stopAll).not.toHaveBeenCalled();
  });
});
