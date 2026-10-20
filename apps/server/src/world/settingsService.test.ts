import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_SETTINGS, MODEL_OPTIONS, type RunSettings } from "@nous/shared";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seedAdmin, TEST_ADMIN_ID } from "../../test/helpers/adminTestSupport";
import { createTestDb, type TestDb } from "../../test/helpers/testDb";
import { recordAudit } from "../admin/audit/auditService";
import { FakeClock } from "../clock/fakeClock";
import type { GenerationConfig } from "../config/generationConfig";
import { admin_audit_logs, agents, daily_usage, generation_events, worlds } from "../db/schema";
import { withTx } from "../db/tx";
import { AppError } from "../lib/errors";
import { newUlid } from "../lib/ids";
import {
  averageNeuronsPerRun,
  countAgentsByState,
  DEFAULT_AVG_NEURONS_PER_RUN,
  estimateDaily,
  getSettingsWithEstimate,
  listPromptVersions,
  toRunSettings,
  toWorldSettingsValues,
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

const TEST_GENERATION_CONFIG: GenerationConfig = {
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

function addAgent(worldId: string, handle: string, activityLevel = 3, state: "active" | "stopped" = "active"): string {
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
  return agentId;
}

function addGenEvent(
  worldId: string,
  agentId: string,
  opts: {
    decidedBy?: "llm" | "gate";
    status?: "succeeded" | "failed" | "running" | "cancelled" | "interrupted";
    neurons?: number;
    startedAt?: string;
  } = {},
): void {
  const status = opts.status ?? "succeeded";
  const startedAt = opts.startedAt ?? clock.nowIso();
  t.db
    .insert(generation_events)
    .values({
      event_id: newUlid(),
      world_id: worldId,
      agent_id: agentId,
      cycle_no: 1,
      cycle_seed: 1,
      status,
      decided_by: opts.decidedBy ?? "llm",
      action: "post",
      model_id: "@cf/google/gemma-4-26b-a4b-it",
      prompt_version: "v1",
      llm_mode: "fixed",
      neurons: opts.neurons ?? 15.0,
      world_time_sec: 0,
      started_at: startedAt,
      finished_at: status === "running" ? null : startedAt,
      usage_date: "2026-10-22",
    })
    .run();
}

function makeWorldService() {
  return createWorldService({
    db: t.db,
    clock,
    scheduler,
    recordAudit: (tx, entry) => {
      recordAudit(tx, clock, entry);
    },
  });
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

describe("estimateDaily", () => {
  it("TC-NOUS58_DEV-01 設計書の例（10体・活動頻度3・活動量100・周期20・平均15.8・上限9500）で dailyRuns=432・dailyNeurons=6826・cycleMinutesFloor=15 になる", () => {
    const activeAgents = Array.from({ length: 10 }, () => ({ activity_level: 3 }));
    const result = estimateDaily(
      { cycleMinutes: 20, activityPercent: 100, dailyNeuronsLimit: 9500 },
      15.8,
      activeAgents,
      TEST_GENERATION_CONFIG,
    );
    expect(result).toEqual({
      cycleMinutesFloor: 15,
      dailyRuns: 432,
      dailyNeurons: 6826,
      avgParticipation: 0.6,
    });
  });

  it("TC-NOUS58_DEV-02 稼働中のエージェントが0体または1巡のNeuronsが0のとき、dailyRuns=0・dailyNeurons=0・cycleMinutesFloor=15・avgParticipation=0 になる", () => {
    const resZeroAgents = estimateDaily(
      { cycleMinutes: 20, activityPercent: 100, dailyNeuronsLimit: 9500 },
      15.8,
      [],
      TEST_GENERATION_CONFIG,
    );
    expect(resZeroAgents).toEqual({
      cycleMinutesFloor: 15,
      dailyRuns: 0,
      dailyNeurons: 0,
      avgParticipation: 0,
    });

    const resZeroNeurons = estimateDaily(
      { cycleMinutes: 20, activityPercent: 100, dailyNeuronsLimit: 100 },
      0,
      [{ activity_level: 5 }],
      TEST_GENERATION_CONFIG,
    );
    expect(resZeroNeurons.cycleMinutesFloor).toBe(15);
    expect(resZeroNeurons.dailyNeurons).toBe(0);
  });

  it("TC-NOUS58_DEV-03 日次Neurons上限が低く15分より長い周期が必要なとき、切り上げた周期の下限を返す", () => {
    // 10体・p=0.6・activityPercent=100 → runsPerCycle=6。avgNeurons=20 → neuronsPerCycle=120
    // dailyNeuronsLimit=1000 → 1日に回せる巡数 = 1000/120 = 8.333... → 1440 / 8.333... = 172.8 → ceil = 173
    const activeAgents = Array.from({ length: 10 }, () => ({ activity_level: 3 }));
    const result = estimateDaily(
      { cycleMinutes: 30, activityPercent: 100, dailyNeuronsLimit: 1000 },
      20,
      activeAgents,
      TEST_GENERATION_CONFIG,
    );
    expect(result.cycleMinutesFloor).toBe(173);
  });
});

describe("averageNeuronsPerRun", () => {
  it("TC-NOUS58_DEV-04 成功したLLM生成が20件未満のときは既定値16.4を返し、gateや失敗は数えない", () => {
    const world = seedWorld();
    const agentId = addAgent(world.world_id, "alice");
    for (let i = 0; i < 19; i++) {
      addGenEvent(world.world_id, agentId, { decidedBy: "llm", status: "succeeded", neurons: 30 });
    }
    addGenEvent(world.world_id, agentId, { decidedBy: "gate", status: "succeeded", neurons: 0 });
    addGenEvent(world.world_id, agentId, { decidedBy: "llm", status: "failed", neurons: 30 });

    expect(averageNeuronsPerRun(t.db)).toBe(DEFAULT_AVG_NEURONS_PER_RUN);
  });

  it("TC-NOUS58_DEV-05 成功したLLM生成が20件以上のときは直近50件の平均を返す", () => {
    const world = seedWorld();
    const agentId = addAgent(world.world_id, "alice");
    // 古い 10 件は neurons=100
    for (let i = 0; i < 10; i++) {
      const ts = new Date(START.getTime() + i * 1000).toISOString();
      addGenEvent(world.world_id, agentId, { neurons: 100, startedAt: ts });
    }
    // 新しい 50 件は neurons=20
    for (let i = 0; i < 50; i++) {
      const ts = new Date(START.getTime() + (i + 100) * 1000).toISOString();
      addGenEvent(world.world_id, agentId, { neurons: 20, startedAt: ts });
    }

    expect(averageNeuronsPerRun(t.db)).toBe(20);
  });
});

describe("listPromptVersions・変換関数・countAgentsByState", () => {
  it("TC-NOUS58_DEV-06 promptsDir の直下で system.md と user.md が両方あるフォルダ名だけを名前の順で返す", () => {
    const dir = mkdtempSync(join(tmpdir(), "nous-prompts-"));
    try {
      mkdirSync(join(dir, "v2"));
      writeFileSync(join(dir, "v2", "system.md"), "sys");
      writeFileSync(join(dir, "v2", "user.md"), "usr");

      mkdirSync(join(dir, "v1"));
      writeFileSync(join(dir, "v1", "system.md"), "sys");
      writeFileSync(join(dir, "v1", "user.md"), "usr");

      // user.md がないフォルダと通常ファイルは除外される
      mkdirSync(join(dir, "incomplete"));
      writeFileSync(join(dir, "incomplete", "system.md"), "sys");
      writeFileSync(join(dir, "README.md"), "readme");

      expect(listPromptVersions(dir)).toEqual(["v1", "v2"]);
      expect(listPromptVersions(join(dir, "nonexistent"))).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("TC-NOUS58_DEV-07 world_settings の行と RunSettings の相互変換、および countAgentsByState が0のstateも含めて返す", () => {
    const world = seedWorld();
    const row = findWorldSettings(t.db, world.world_id)!;
    const runSettings = toRunSettings(row);
    expect(runSettings).toEqual(DEFAULT_SETTINGS);

    const updatedValues = toWorldSettingsValues({ ...runSettings, cycleMinutes: 45 }, "2026-10-22T01:00:00.000Z");
    expect(updatedValues.cycle_minutes).toBe(45);
    expect(updatedValues.updated_at).toBe("2026-10-22T01:00:00.000Z");

    expect(countAgentsByState(t.db, world.world_id)).toEqual({ active: 0, stopped: 0 });
    addAgent(world.world_id, "alice", 3, "active");
    addAgent(world.world_id, "bob", 3, "active");
    expect(countAgentsByState(t.db, world.world_id)).toEqual({ active: 2, stopped: 0 });
  });
});

describe("getSettingsWithEstimate・updateSettings", () => {
  it("TC-NOUS58_DEV-08 getSettingsWithEstimate は世界が無ければ初期世界を作り、設定と見込みと選択肢を返す", () => {
    const res = getSettingsWithEstimate(t.db, clock, {
      generationConfig: TEST_GENERATION_CONFIG,
    });
    expect(res.settings).toEqual(DEFAULT_SETTINGS);
    expect(res.avgNeuronsPerRun).toBe(DEFAULT_AVG_NEURONS_PER_RUN);
    expect(res.activeAgents).toBe(0);
    expect(res.avgParticipation).toBe(0);
    expect(res.estimatedCycleMinutes).toBe(15);
    expect(res.estimatedDailyRuns).toBe(0);
    expect(res.estimatedDailyNeurons).toBe(0);
    expect(res.modelOptions).toEqual([...MODEL_OPTIONS]);
    expect(res.promptVersions).toContain("v1");
  });

  it("TC-NOUS58_DEV-09 updateSettings は設定を保存し、変更前後の全項目を admin_audit_logs に記録する（next_cycle_at は変えない）", async () => {
    const world = seedWorld();
    addAgent(world.world_id, "alice", 3, "active");
    const planned = "2026-10-22T00:25:00.000Z";
    t.db.update(worlds).set({ next_cycle_at: planned }).where(eq(worlds.world_id, world.world_id)).run();

    const nextSettings: RunSettings = {
      ...DEFAULT_SETTINGS,
      cycleMinutes: 30,
      activityPercent: 80,
    };

    const res = await updateSettings(
      t.db,
      clock,
      { scheduler, worldService: makeWorldService() },
      nextSettings,
      ADMIN,
      { generationConfig: TEST_GENERATION_CONFIG },
    );

    expect(res.settings).toEqual(nextSettings);
    expect(res.stateChanged).toBeNull();
    expect(findCurrentWorld(t.db)?.next_cycle_at).toBe(planned);

    const logs = t.db.select().from(admin_audit_logs).all();
    expect(logs).toHaveLength(1);
    expect(logs[0]?.operation).toBe("settings.update");
    expect(logs[0]?.target_type).toBe("settings");
    expect(logs[0]?.target_id).toBe(world.world_id);
    expect(JSON.parse(logs[0]!.before_json!)).toEqual(DEFAULT_SETTINGS);
    expect(JSON.parse(logs[0]!.after_json!)).toEqual(nextSettings);
  });

  it("TC-NOUS58_DEV-10 updateSettings で存在しない promptVersion を指定すると VALIDATION_ERROR（fields.promptVersion）を投げる", async () => {
    seedWorld();
    const badInput: RunSettings = {
      ...DEFAULT_SETTINGS,
      promptVersion: "v999",
    };

    try {
      await updateSettings(t.db, clock, { scheduler, worldService: makeWorldService() }, badInput, ADMIN, {
        generationConfig: TEST_GENERATION_CONFIG,
      });
      throw new Error("エラーが投げられませんでした");
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe("VALIDATION_ERROR");
      expect((err as AppError).fields).toHaveProperty("promptVersion");
    }
  });

  it("TC-NOUS58_DEV-11 limit_stopped（neurons_limit/runs_limit）で上限を引き上げて上限内になれば running に戻り wake するが、free_tier_error は戻さない", async () => {
    const world = seedWorld();
    addAgent(world.world_id, "alice");
    t.db.insert(daily_usage).values({ usage_date: "2026-10-22", neurons: 5000, runs: 100 }).run();
    t.db
      .update(worlds)
      .set({ state: "limit_stopped", stop_reason: "neurons_limit", running_since: null })
      .where(eq(worlds.world_id, world.world_id))
      .run();

    const res = await updateSettings(
      t.db,
      clock,
      { scheduler, worldService: makeWorldService() },
      { ...DEFAULT_SETTINGS, dailyNeuronsLimit: 9500 },
      ADMIN,
      { generationConfig: TEST_GENERATION_CONFIG },
    );

    expect(res.stateChanged).toBe("limit_stopped→running");
    expect(findCurrentWorld(t.db)?.state).toBe("running");
    expect(findCurrentWorld(t.db)?.stop_reason).toBeNull();
    expect(scheduler.wake).toHaveBeenCalledTimes(1);

    // free_tier_error のときは上限を変えても limit_stopped のまま
    scheduler.wake.mockClear();
    t.db
      .update(worlds)
      .set({ state: "limit_stopped", stop_reason: "free_tier_error", running_since: null })
      .where(eq(worlds.world_id, world.world_id))
      .run();

    const resFreeTier = await updateSettings(
      t.db,
      clock,
      { scheduler, worldService: makeWorldService() },
      { ...DEFAULT_SETTINGS, dailyNeuronsLimit: 10000 },
      ADMIN,
      { generationConfig: TEST_GENERATION_CONFIG },
    );

    expect(resFreeTier.stateChanged).toBeNull();
    expect(findCurrentWorld(t.db)?.state).toBe("limit_stopped");
    expect(findCurrentWorld(t.db)?.stop_reason).toBe("free_tier_error");
    expect(scheduler.wake).not.toHaveBeenCalled();
  });

  it("TC-NOUS58_DEV-12 running で上限を引き下げて利用量が上限以上になれば limit_stopped に遷移し stopAll('limit') を呼ぶ", async () => {
    const world = seedWorld();
    addAgent(world.world_id, "alice");
    const ws = makeWorldService();
    ws.startWorld(ADMIN);
    t.db.insert(daily_usage).values({ usage_date: "2026-10-22", neurons: 500, runs: 50 }).run();

    const res = await updateSettings(
      t.db,
      clock,
      { scheduler, worldService: ws },
      { ...DEFAULT_SETTINGS, dailyRunsLimit: 50 },
      ADMIN,
      { generationConfig: TEST_GENERATION_CONFIG },
    );

    expect(res.stateChanged).toBe("running→limit_stopped");
    expect(findCurrentWorld(t.db)?.state).toBe("limit_stopped");
    expect(findCurrentWorld(t.db)?.stop_reason).toBe("runs_limit");
    expect(scheduler.stopAll).toHaveBeenCalledWith("limit");
  });
});
