import { DEFAULT_SETTINGS, FREE_TIER_NEURONS, type RunSettings } from "@nous/shared";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureLogger, seedAdmin, seedSession } from "../../test/helpers/adminTestSupport";
import { createTestDb, type TestDb } from "../../test/helpers/testDb";
import { createAdminApp } from "../admin/adminServer";
import { CSRF_HEADER } from "../admin/middleware/csrf";
import { ADMIN_COOKIE } from "../admin/middleware/sessionAuth";
import { FakeClock } from "../clock/fakeClock";
import { admin_audit_logs, agents, daily_usage, generation_events, memories, worlds } from "../db/schema";
import { withTx } from "../db/tx";
import { newUlid } from "../lib/ids";
import { configureWorldApi, resetWorldApi } from "./worldRoutes";
import { createInitialWorld, findCurrentWorld, type SchedulerControl, type WorldRow } from "./worldService";

const START = new Date("2026-10-22T00:00:00.000Z");

let t: TestDb;
let clock: FakeClock;
let logCapture: ReturnType<typeof captureLogger>;
let session: { cookie: string; csrfToken: string; sessionHash: string };
let scheduler: SchedulerControl & { stopAll: ReturnType<typeof vi.fn>; wake: ReturnType<typeof vi.fn> };

function app() {
  return createAdminApp({ db: t.db, clock, logger: logCapture.logger }, { staticDir: null });
}

function authHeaders(withCsrf = false): Record<string, string> {
  const headers: Record<string, string> = {
    Cookie: `${ADMIN_COOKIE}=${session.cookie}`,
  };
  if (withCsrf) {
    headers[CSRF_HEADER] = session.csrfToken;
  }
  return headers;
}

function seedWorld(): WorldRow {
  return withTx(t.db, (tx) => createInitialWorld(tx, clock.now()));
}

function addAgent(worldId: string, handle: string, state: "active" | "stopped" = "active", activityLevel = 3): string {
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
      activity_level: activityLevel,
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

beforeEach(() => {
  t = createTestDb();
  clock = new FakeClock(START);
  logCapture = captureLogger();
  seedAdmin(t.db, START);
  session = seedSession(t.db, START);
  scheduler = { stopAll: vi.fn(async () => 0), wake: vi.fn() };
  configureWorldApi({ scheduler });
});

afterEach(() => {
  resetWorldApi();
  t.cleanup();
});

describe("GET /admin/api/world", () => {
  it("TC-NOUS58_DEV-13 世界がまだ無いときは準備中の初期世界を作って返す", async () => {
    const res = await app().request("/admin/api/world", { headers: authHeaders() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      name: "世界 2026-10-22",
      state: "preparing",
      stopReason: null,
      worldTimeSec: 0,
      cycleNo: 0,
      nextCycleAt: null,
      usage: {
        usageDate: "2026-10-22",
        neurons: 0,
        neuronsLimit: 9500,
        runs: 0,
        runsLimit: 480,
        freeTierNeurons: FREE_TIER_NEURONS,
      },
      runningGenerations: 0,
      agentCounts: { active: 0, stopped: 0 },
    });
  });

  it("TC-NOUS58_DEV-14 稼働中の世界内時間・利用量・実行中生成数・stateごとのエージェント数を返す", async () => {
    const world = seedWorld();
    const aliceId = addAgent(world.world_id, "alice", "active");
    addAgent(world.world_id, "bob", "active");
    addAgent(world.world_id, "charlie", "stopped");
    t.db.insert(daily_usage).values({ usage_date: "2026-10-22", neurons: 2104.5, runs: 132 }).run();

    // start して 120 秒進める
    await app().request("/admin/api/world/start", { method: "POST", headers: authHeaders(true) });
    await clock.advance(120_000);

    // 実行中の生成を 1 件入れる
    t.db
      .insert(generation_events)
      .values({
        event_id: newUlid(),
        world_id: world.world_id,
        agent_id: aliceId,
        cycle_no: 1,
        cycle_seed: 1,
        status: "running",
        decided_by: "llm",
        model_id: "@cf/google/gemma-4-26b-a4b-it",
        prompt_version: "v1",
        llm_mode: "fixed",
        world_time_sec: 10,
        started_at: clock.nowIso(),
        usage_date: "2026-10-22",
      })
      .run();

    const res = await app().request("/admin/api/world", { headers: authHeaders() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      worldId: world.world_id,
      state: "running",
      worldTimeSec: 120,
      usage: {
        usageDate: "2026-10-22",
        neurons: 2104.5,
        neuronsLimit: 9500,
        runs: 132,
        runsLimit: 480,
        freeTierNeurons: FREE_TIER_NEURONS,
      },
      runningGenerations: 1,
      agentCounts: { active: 2, stopped: 1 },
    });
  });
});

describe("POST /admin/api/world/start・pause・resume・emergency-stop", () => {
  it("TC-NOUS58_DEV-15 start・pause・resume・emergency-stop の一連の遷移が 200 を返し、admin_audit_logs に記録される", async () => {
    const world = seedWorld();
    addAgent(world.world_id, "alice", "active");
    const a = app();

    // start
    const startRes = await a.request("/admin/api/world/start", {
      method: "POST",
      headers: authHeaders(true),
    });
    expect(startRes.status).toBe(200);
    expect(await startRes.json()).toEqual({
      state: "running",
      startedAt: START.toISOString(),
    });
    expect(scheduler.wake).toHaveBeenCalledTimes(1);

    // pause
    await clock.advance(45_000);
    const pauseRes = await a.request("/admin/api/world/pause", {
      method: "POST",
      headers: authHeaders(true),
    });
    expect(pauseRes.status).toBe(200);
    expect(await pauseRes.json()).toEqual({
      state: "paused",
      worldTimeSec: 45,
      runningGenerations: 0,
    });
    expect(scheduler.stopAll).toHaveBeenCalledWith("pause");

    // resume
    const resumeRes = await a.request("/admin/api/world/resume", {
      method: "POST",
      headers: authHeaders(true),
    });
    expect(resumeRes.status).toBe(200);
    expect(await resumeRes.json()).toEqual({
      state: "running",
      stopReason: null,
    });

    // emergency-stop
    scheduler.stopAll.mockResolvedValueOnce(3);
    const emRes = await a.request("/admin/api/world/emergency-stop", {
      method: "POST",
      headers: authHeaders(true),
    });
    expect(emRes.status).toBe(200);
    expect(await emRes.json()).toEqual({
      state: "emergency_stopped",
      cancelledGenerations: 3,
    });
    expect(scheduler.stopAll).toHaveBeenCalledWith("emergency");

    const audits = t.db.select().from(admin_audit_logs).all();
    expect(audits.map((r) => r.operation)).toEqual([
      "world.start",
      "world.pause",
      "world.resume",
      "world.emergency_stop",
    ]);
  });

  it("TC-NOUS58_DEV-16 状態不整合（STATE_CONFLICT）とエージェント0体（NO_AGENTS）で 409 を返す", async () => {
    seedWorld();
    const a = app();

    // エージェント 0 体で start → 409 NO_AGENTS
    const noAgentsRes = await a.request("/admin/api/world/start", {
      method: "POST",
      headers: authHeaders(true),
    });
    expect(noAgentsRes.status).toBe(409);
    expect(await noAgentsRes.json()).toMatchObject({ error: { code: "NO_AGENTS" } });

    // preparing で pause → 409 STATE_CONFLICT
    const pauseConflictRes = await a.request("/admin/api/world/pause", {
      method: "POST",
      headers: authHeaders(true),
    });
    expect(pauseConflictRes.status).toBe(409);
    expect(await pauseConflictRes.json()).toMatchObject({ error: { code: "STATE_CONFLICT" } });

    // preparing で resume → 409 STATE_CONFLICT
    const resumeConflictRes = await a.request("/admin/api/world/resume", {
      method: "POST",
      headers: authHeaders(true),
    });
    expect(resumeConflictRes.status).toBe(409);
    expect(await resumeConflictRes.json()).toMatchObject({ error: { code: "STATE_CONFLICT" } });

    // preparing で emergency-stop → 409 STATE_CONFLICT
    const emConflictRes = await a.request("/admin/api/world/emergency-stop", {
      method: "POST",
      headers: authHeaders(true),
    });
    expect(emConflictRes.status).toBe(409);
    expect(await emConflictRes.json()).toMatchObject({ error: { code: "STATE_CONFLICT" } });
  });
});

describe("POST /admin/api/world/reset", () => {
  it("TC-NOUS58_DEV-17 一時停止の世界で confirmName が一致すれば 200 でリセットし、監査ログを残す", async () => {
    const world = seedWorld();
    addAgent(world.world_id, "alice", "active");
    const a = app();
    await a.request("/admin/api/world/start", { method: "POST", headers: authHeaders(true) });
    await a.request("/admin/api/world/pause", { method: "POST", headers: authHeaders(true) });

    const res = await a.request("/admin/api/world/reset", {
      method: "POST",
      headers: { ...authHeaders(true), "Content-Type": "application/json" },
      body: JSON.stringify({ confirmName: "世界 2026-10-22" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      archivedWorldId: world.world_id,
      state: "preparing",
    });
    expect(findCurrentWorld(t.db)?.world_id).toBe(body.newWorldId);
    expect(t.db.select().from(admin_audit_logs).all().at(-1)?.operation).toBe("world.reset");
  });

  it("TC-NOUS58_DEV-18 reset の不正な JSON・空の confirmName は 400 VALIDATION_ERROR、不一致は 400 CONFIRM_MISMATCH、生成実行中は 409 GENERATION_RUNNING", async () => {
    const world = seedWorld();
    const aliceId = addAgent(world.world_id, "alice", "active");
    const a = app();
    await a.request("/admin/api/world/start", { method: "POST", headers: authHeaders(true) });
    await a.request("/admin/api/world/pause", { method: "POST", headers: authHeaders(true) });

    // 非 JSON
    const badJsonRes = await a.request("/admin/api/world/reset", {
      method: "POST",
      headers: { ...authHeaders(true), "Content-Type": "application/json" },
      body: "{not-json",
    });
    expect(badJsonRes.status).toBe(400);
    expect(await badJsonRes.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });

    // 空文字（WorldResetRequestSchema 違反）
    const emptyNameRes = await a.request("/admin/api/world/reset", {
      method: "POST",
      headers: { ...authHeaders(true), "Content-Type": "application/json" },
      body: JSON.stringify({ confirmName: "" }),
    });
    expect(emptyNameRes.status).toBe(400);
    expect(await emptyNameRes.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR", fields: { confirmName: expect.any(String) } },
    });

    // 名前不一致
    const mismatchRes = await a.request("/admin/api/world/reset", {
      method: "POST",
      headers: { ...authHeaders(true), "Content-Type": "application/json" },
      body: JSON.stringify({ confirmName: "違う名前" }),
    });
    expect(mismatchRes.status).toBe(400);
    expect(await mismatchRes.json()).toMatchObject({ error: { code: "CONFIRM_MISMATCH" } });

    // 実行中の生成あり
    t.db
      .insert(generation_events)
      .values({
        event_id: newUlid(),
        world_id: world.world_id,
        agent_id: aliceId,
        cycle_no: 1,
        cycle_seed: 1,
        status: "running",
        decided_by: "llm",
        model_id: "@cf/google/gemma-4-26b-a4b-it",
        prompt_version: "v1",
        llm_mode: "fixed",
        world_time_sec: 0,
        started_at: clock.nowIso(),
        usage_date: "2026-10-22",
      })
      .run();

    const genRunningRes = await a.request("/admin/api/world/reset", {
      method: "POST",
      headers: { ...authHeaders(true), "Content-Type": "application/json" },
      body: JSON.stringify({ confirmName: "世界 2026-10-22" }),
    });
    expect(genRunningRes.status).toBe(409);
    expect(await genRunningRes.json()).toMatchObject({ error: { code: "GENERATION_RUNNING" } });
  });
});

describe("GET /admin/api/settings・PUT /admin/api/settings", () => {
  it("TC-NOUS58_DEV-19 GET /settings と PUT /settings が正常に応答し、監査ログに記録される", async () => {
    const world = seedWorld();
    for (let i = 0; i < 10; i++) {
      addAgent(world.world_id, `agent_${i}`, "active", 3);
    }
    const a = app();

    const getRes = await a.request("/admin/api/settings", { headers: authHeaders() });
    expect(getRes.status).toBe(200);
    const getBody = await getRes.json();
    expect(getBody).toMatchObject({
      settings: DEFAULT_SETTINGS,
      avgNeuronsPerRun: 16.4,
      activeAgents: 10,
      avgParticipation: 0.6,
      estimatedCycleMinutes: 15,
      estimatedDailyRuns: 432,
      estimatedDailyNeurons: 7085,
      promptVersions: ["v1"],
    });

    const updated: RunSettings = {
      ...DEFAULT_SETTINGS,
      cycleMinutes: 30,
      dailyNeuronsLimit: 8000,
    };

    const validPutRes = await a.request("/admin/api/settings", {
      method: "PUT",
      headers: { ...authHeaders(true), "Content-Type": "application/json" },
      body: JSON.stringify(updated),
    });
    expect(validPutRes.status).toBe(200);
    expect(await validPutRes.json()).toEqual({
      settings: updated,
      estimatedCycleMinutes: 18,
      estimatedDailyRuns: 288,
      stateChanged: null,
    });

    const audits = t.db.select().from(admin_audit_logs).all();
    expect(audits).toHaveLength(1);
    expect(audits[0]?.operation).toBe("settings.update");
  });

  it("TC-NOUS58_DEV-20 PUT /settings の範囲外入力・未知の promptVersion・非 JSON は 400 VALIDATION_ERROR、世界が archived なら 409 STATE_CONFLICT", async () => {
    const world = seedWorld();
    const a = app();

    // 範囲外
    const outOfRangeRes = await a.request("/admin/api/settings", {
      method: "PUT",
      headers: { ...authHeaders(true), "Content-Type": "application/json" },
      body: JSON.stringify({ ...DEFAULT_SETTINGS, cycleMinutes: 5 }),
    });
    expect(outOfRangeRes.status).toBe(400);
    expect(await outOfRangeRes.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR", fields: { cycleMinutes: expect.any(String) } },
    });

    // 未知の promptVersion
    const badPromptRes = await a.request("/admin/api/settings", {
      method: "PUT",
      headers: { ...authHeaders(true), "Content-Type": "application/json" },
      body: JSON.stringify({ ...DEFAULT_SETTINGS, promptVersion: "v_unknown" }),
    });
    expect(badPromptRes.status).toBe(400);
    expect(await badPromptRes.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR", fields: { promptVersion: expect.any(String) } },
    });

    // 非 JSON
    const badJsonRes = await a.request("/admin/api/settings", {
      method: "PUT",
      headers: { ...authHeaders(true), "Content-Type": "application/json" },
      body: "invalid-json",
    });
    expect(badJsonRes.status).toBe(400);
    expect(await badJsonRes.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });

    // 世界が archived（現在の世界が無い状態）なら 409 STATE_CONFLICT
    t.db
      .update(worlds)
      .set({ state: "archived", archived_at: clock.nowIso() })
      .where(eq(worlds.world_id, world.world_id))
      .run();

    const conflictRes = await a.request("/admin/api/settings", {
      method: "PUT",
      headers: { ...authHeaders(true), "Content-Type": "application/json" },
      body: JSON.stringify(DEFAULT_SETTINGS),
    });
    expect(conflictRes.status).toBe(409);
    expect(await conflictRes.json()).toMatchObject({ error: { code: "STATE_CONFLICT" } });
  });

  it("TC-NOUS58_DEV-21 scheduler 未設定（resetWorldApi 後）は仮実装が使われ、scheduler_not_configured の warn ログが出る", async () => {
    resetWorldApi();
    const world = seedWorld();
    addAgent(world.world_id, "alice", "active");
    const a = app();

    const startRes = await a.request("/admin/api/world/start", {
      method: "POST",
      headers: authHeaders(true),
    });
    expect(startRes.status).toBe(200);

    const emRes = await a.request("/admin/api/world/emergency-stop", {
      method: "POST",
      headers: authHeaders(true),
    });
    expect(emRes.status).toBe(200);
    expect(await emRes.json()).toEqual({
      state: "emergency_stopped",
      cancelledGenerations: 0,
    });

    const warns = logCapture.lines().filter((l) => l.level === "warn" && l.msg === "scheduler_not_configured");
    expect(warns.length).toBeGreaterThanOrEqual(2);
  });
});
