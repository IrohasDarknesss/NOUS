// 単体テスト（NOUS-97）。観点表は docs/test/unit/NOUS-97/観点表_settings.json
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_SETTINGS, SETTINGS_RANGES, type RunSettings } from "@nous/shared";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seedAdmin, TEST_ADMIN_ID } from "../../test/helpers/adminTestSupport";
import { createTestDb, type TestDb } from "../../test/helpers/testDb";
import { recordAudit } from "../admin/audit/auditService";
import { FakeClock } from "../clock/fakeClock";
import type { GenerationConfig } from "../config/generationConfig";
import { agents, daily_usage, generation_events, world_settings, worlds } from "../db/schema";
import { withTx } from "../db/tx";
import { newUlid } from "../lib/ids";
import {
  averageNeuronsPerRun,
  countAgentsByState,
  estimateDaily,
  getSettingsWithEstimate,
  listActiveAgents,
  listPromptVersions,
  updateSettings,
} from "./settingsService";
import {
  createInitialWorld,
  createWorldService,
  findCurrentWorld,
  findWorldSettings,
  type SchedulerControl,
  type WorldRow,
} from "./worldService";

const START = new Date("2026-10-22T00:00:00.000Z");
const ADMIN = { adminId: TEST_ADMIN_ID };

const CONFIG: GenerationConfig = {
  participation: { "1": 0.3, "2": 0.45, "3": 0.6, "4": 0.75, "5": 0.9 },
  candidateCount: 2,
  weights: { post: 3.0, reply: 3.0, like: 2.5, follow: 1.5, unfollow: 0.5 },
  recentPenalty: 0.4,
  firstPersonRules: [],
};

let t: TestDb;
let clock: FakeClock;
let scheduler: SchedulerControl & { stopAll: ReturnType<typeof vi.fn>; wake: ReturnType<typeof vi.fn> };

function seedWorld(): WorldRow {
  return withTx(t.db, (tx) => createInitialWorld(tx, clock.now()));
}

function addAgent(
  worldId: string,
  handle: string,
  opts: { level?: number; state?: "active" | "stopped"; createdAt?: string } = {},
): string {
  const agentId = newUlid();
  const iso = opts.createdAt ?? clock.nowIso();
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
      activity_level: opts.level ?? 3,
      state: opts.state ?? "active",
      created_at: iso,
      updated_at: iso,
    })
    .run();
  return agentId;
}

function addSucceeded(worldId: string, agentId: string, neurons: number, i: number): void {
  const startedAt = new Date(START.getTime() + i * 1000).toISOString();
  t.db
    .insert(generation_events)
    .values({
      event_id: newUlid(),
      world_id: worldId,
      agent_id: agentId,
      cycle_no: 1,
      cycle_seed: 1,
      status: "succeeded",
      decided_by: "llm",
      action: "post",
      model_id: "@cf/google/gemma-4-26b-a4b-it",
      prompt_version: "v1",
      llm_mode: "fixed",
      neurons,
      world_time_sec: 0,
      started_at: startedAt,
      finished_at: startedAt,
      usage_date: "2026-10-22",
    })
    .run();
}

function setUsage(neurons: number, runs: number): void {
  t.db.insert(daily_usage).values({ usage_date: "2026-10-22", neurons, runs }).run();
}

function setWorld(worldId: string, values: Partial<WorldRow>): void {
  t.db.update(worlds).set(values).where(eq(worlds.world_id, worldId)).run();
}

function deps() {
  const worldService = createWorldService({
    db: t.db,
    clock,
    scheduler,
    recordAudit: (tx, entry) => {
      recordAudit(tx, clock, entry);
    },
  });
  return { scheduler, worldService };
}

function update(input: unknown) {
  return updateSettings(t.db, clock, deps(), input, ADMIN, { generationConfig: CONFIG });
}

beforeEach(() => {
  t = createTestDb();
  clock = new FakeClock(START);
  seedAdmin(t.db, START);
  scheduler = { stopAll: vi.fn(async () => 0), wake: vi.fn() };
});

afterEach(() => {
  t.cleanup();
});

describe("estimateDaily（単体テスト）", () => {
  const tenAgents = Array.from({ length: 10 }, () => ({ activity_level: 3 }));

  it("TC-UT_WLD-040 world_settings の行の形（snake_case）でも RunSettings の形と同じ見込みを返す", () => {
    const camel = estimateDaily(
      { cycleMinutes: 20, activityPercent: 100, dailyNeuronsLimit: 9500 },
      15.8,
      tenAgents,
      CONFIG,
    );

    const snake = estimateDaily(
      { cycle_minutes: 20, activity_percent: 100, daily_neurons_limit: 9500 },
      15.8,
      tenAgents,
      CONFIG,
    );

    expect(snake).toEqual(camel);
    expect(snake).toMatchObject({ dailyRuns: 432, dailyNeurons: 6826, cycleMinutesFloor: 15 });
  });

  it("TC-UT_WLD-041 generation.json にない活動頻度のエージェントは参加の確率 0 として平均に入れる", () => {
    const result = estimateDaily(DEFAULT_SETTINGS, 15.8, [{ activity_level: 3 }, { activity_level: 9 }], CONFIG);

    expect(result.avgParticipation).toBeCloseTo(0.3, 10);
  });

  it.each([
    [576, 15],
    [575, 16],
  ])("TC-UT_WLD-042 周期の下限は 15 分ちょうどと、それを超えて切り上げる境界で正しい（%j）", (limit, floor) => {
    const settings = { cycleMinutes: 20, activityPercent: 100, dailyNeuronsLimit: limit };

    const result = estimateDaily(settings, 10, [{ activity_level: 3 }], CONFIG);

    expect(result.cycleMinutesFloor).toBe(floor);
  });

  it("TC-UT_WLD-043 活動量が下限の 10% なら、1巡の回数を 1/10 にして 1日の回数と Neurons を出す", () => {
    const settings = { cycleMinutes: 20, activityPercent: 10, dailyNeuronsLimit: 9500 };

    const result = estimateDaily(settings, 15.8, tenAgents, CONFIG);

    expect(result).toMatchObject({ dailyRuns: 43, dailyNeurons: 683, cycleMinutesFloor: 15 });
  });
});

describe("settingsService の読み取り（単体テスト）", () => {
  it("TC-UT_WLD-044 成功した LLM の生成がちょうど 20 件なら、既定値ではなく実測の平均を返す", () => {
    const world = seedWorld();
    const agentId = addAgent(world.world_id, "alice");
    for (let i = 0; i < 20; i++) addSucceeded(world.world_id, agentId, i < 10 ? 20 : 40, i);

    const avg = averageNeuronsPerRun(t.db);

    expect(avg).toBe(30);
  });

  it("TC-UT_WLD-045 prompts のフォルダがなければ、版の一覧は空にする", () => {
    const dir = mkdtempSync(join(tmpdir(), "nous-ut-prompts-"));
    rmSync(dir, { recursive: true, force: true });

    const versions = listPromptVersions(dir);

    expect(versions).toEqual([]);
  });

  it("TC-UT_WLD-046 countAgentsByState はほかの世界のエージェントを数えない", () => {
    const old = seedWorld();
    addAgent(old.world_id, "old1");
    addAgent(old.world_id, "old2", { state: "stopped" });
    setWorld(old.world_id, { state: "archived", archived_at: clock.nowIso() });
    const world = seedWorld();
    addAgent(world.world_id, "alice");

    const counts = countAgentsByState(t.db, world.world_id);

    expect(counts).toEqual({ active: 1, stopped: 0 });
  });

  it("TC-UT_WLD-047 listActiveAgents は active のエージェントだけを created_at の順に返す", () => {
    const world = seedWorld();
    addAgent(world.world_id, "late", { createdAt: "2026-10-22T00:00:02.000Z" });
    addAgent(world.world_id, "stopped", { state: "stopped", createdAt: "2026-10-22T00:00:00.000Z" });
    addAgent(world.world_id, "early", { createdAt: "2026-10-22T00:00:01.000Z" });

    const rows = listActiveAgents(t.db, world.world_id);

    expect(rows.map((r) => r.handle)).toEqual(["early", "late"]);
  });

  it("TC-UT_WLD-048 getSettingsWithEstimate は世界があれば新しく作らず、その世界の稼働中の体数と参加の確率の平均を返す", () => {
    const world = seedWorld();
    addAgent(world.world_id, "a", { level: 1 });
    addAgent(world.world_id, "b", { level: 5 });
    addAgent(world.world_id, "c", { level: 5, state: "stopped" });

    const res = getSettingsWithEstimate(t.db, clock, { generationConfig: CONFIG });

    expect(t.db.select().from(worlds).all()).toHaveLength(1);
    expect(res.activeAgents).toBe(2);
    expect(res.avgParticipation).toBeCloseTo(0.6, 10);
  });
});

describe("updateSettings（単体テスト）", () => {
  it("TC-UT_WLD-049 limit_stopped で新しい上限でもまだ上限の外なら、設定は保存して状態は変えない", async () => {
    const world = seedWorld();
    setUsage(9000, 10);
    setWorld(world.world_id, { state: "limit_stopped", stop_reason: "neurons_limit" });

    const res = await update({ ...DEFAULT_SETTINGS, dailyNeuronsLimit: 9000 });

    expect(res.stateChanged).toBeNull();
    expect(findCurrentWorld(t.db)).toMatchObject({ state: "limit_stopped", stop_reason: "neurons_limit" });
    expect(findWorldSettings(t.db, world.world_id)?.daily_neurons_limit).toBe(9000);
    expect(scheduler.wake).not.toHaveBeenCalled();
  });

  it("TC-UT_WLD-050 limit_stopped から running に戻すとき、未来の next_cycle_at はそのまま残す", async () => {
    const world = seedWorld();
    setUsage(100, 480);
    const planned = "2026-10-22T00:15:00.000Z";
    setWorld(world.world_id, { state: "limit_stopped", stop_reason: "runs_limit", next_cycle_at: planned });

    const res = await update({ ...DEFAULT_SETTINGS, dailyRunsLimit: 481 });

    expect(res.stateChanged).toBe("limit_stopped→running");
    expect(findCurrentWorld(t.db)).toMatchObject({
      state: "running",
      next_cycle_at: planned,
      running_since: START.toISOString(),
      heartbeat_at: START.toISOString(),
    });
  });

  it("TC-UT_WLD-051 running で新しい上限の中なら状態を変えず、stateChanged は null で stopAll も呼ばない", async () => {
    const world = seedWorld();
    addAgent(world.world_id, "alice");
    deps().worldService.startWorld(ADMIN);
    setUsage(100, 10);

    const res = await update({ ...DEFAULT_SETTINGS, dailyRunsLimit: 11 });

    expect(res.stateChanged).toBeNull();
    expect(findCurrentWorld(t.db)?.state).toBe("running");
    expect(scheduler.stopAll).not.toHaveBeenCalled();
  });

  it("TC-UT_WLD-052 preparing の世界は、利用量が新しい上限の外でも設定だけを保存し、状態は変えない", async () => {
    const world = seedWorld();
    setUsage(100, 10);

    const res = await update({ ...DEFAULT_SETTINGS, dailyRunsLimit: 10 });

    expect(res.stateChanged).toBeNull();
    expect(findCurrentWorld(t.db)?.state).toBe("preparing");
    expect(findWorldSettings(t.db, world.world_id)?.daily_runs_limit).toBe(10);
  });

  it.each([["min"], ["max"]] as const)(
    "TC-UT_WLD-053 数値の項目がすべて下限ちょうど・上限ちょうどでも保存できる（%j）",
    async (edge) => {
      const world = seedWorld();
      const input: RunSettings = {
        ...DEFAULT_SETTINGS,
        ...Object.fromEntries(Object.entries(SETTINGS_RANGES).map(([key, range]) => [key, range[edge]])),
      };

      await update(input);

      const row = t.db.select().from(world_settings).where(eq(world_settings.world_id, world.world_id)).get()!;
      expect(row).toMatchObject({
        cycle_minutes: SETTINGS_RANGES.cycleMinutes[edge],
        activity_percent: SETTINGS_RANGES.activityPercent[edge],
        max_ref_posts: SETTINGS_RANGES.maxRefPosts[edge],
        max_memory_chars: SETTINGS_RANGES.maxMemoryChars[edge],
        max_input_tokens: SETTINGS_RANGES.maxInputTokens[edge],
        max_output_tokens: SETTINGS_RANGES.maxOutputTokens[edge],
        daily_neurons_limit: SETTINGS_RANGES.dailyNeuronsLimit[edge],
        daily_runs_limit: SETTINGS_RANGES.dailyRunsLimit[edge],
        max_concurrency: SETTINGS_RANGES.maxConcurrency[edge],
      });
    },
  );

  it("TC-UT_WLD-054 応答の見込みは、保存した新しい設定で計算する", async () => {
    const world = seedWorld();
    for (let i = 0; i < 10; i++) addAgent(world.world_id, `a${i}`);

    const res = await update({ ...DEFAULT_SETTINGS, cycleMinutes: 40 });

    expect(res.estimatedDailyRuns).toBe(216);
    expect(res.settings.cycleMinutes).toBe(40);
  });
});
