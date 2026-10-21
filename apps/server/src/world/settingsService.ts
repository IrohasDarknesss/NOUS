// 実行設定の取得・検証・保存・見込みの計算（BE 詳細設計 world 2章 GET/PUT /admin/api/settings、3章、4章）
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  MODEL_OPTIONS,
  SETTINGS_RANGES,
  SettingsSchema,
  type RunSettings,
  type SettingsInput,
  type SettingsResponse,
  type SettingsUpdateResponse,
} from "@nous/shared";
import { and, count, desc, eq } from "drizzle-orm";
import { recordAudit } from "../admin/audit/auditService";
import { utcDate, type Clock } from "../clock/clock";
import type { GenerationConfig } from "../config/generationConfig";
import type { Db } from "../db/client";
import { agents, generation_events, world_settings, worlds } from "../db/schema";
import { withTx, type DbOrTx } from "../db/tx";
import { DEFAULT_PROMPTS_DIR } from "../generation/promptBuilder";
import { AppError } from "../lib/errors";
import { isWithinLimits, limitReason } from "./limits";
import { canTransition } from "./stateMachine";
import {
  createInitialWorld,
  findCurrentWorld,
  findWorldSettings,
  getUsage,
  type SchedulerControl,
  type WorldAdmin,
  type WorldRow,
  type WorldService,
  type WorldSettingsRow,
} from "./worldService";

export type AgentRow = typeof agents.$inferSelect;

/** 直近の成功した LLM 生成が 20 件未満のときの 1 回あたり Neurons の見積もり値（world 2章・4章） */
export const DEFAULT_AVG_NEURONS_PER_RUN = 16.4;
/** averageNeuronsPerRun で参照する直近の件数の上限 */
export const AVG_NEURONS_SAMPLE_LIMIT = 50;
/** averageNeuronsPerRun で実測平均を使う最小の件数 */
export const AVG_NEURONS_MIN_SAMPLES = 20;

const MINUTES_PER_DAY = 1440;

export interface DailyEstimate {
  cycleMinutesFloor: number;
  dailyRuns: number;
  dailyNeurons: number;
  avgParticipation: number;
}

export interface SettingsServiceOptions {
  generationConfig: GenerationConfig;
  promptsDir?: string;
}

/** world_settings の行（snake_case）を RunSettings（camelCase）に変換する */
export function toRunSettings(row: WorldSettingsRow): RunSettings {
  return {
    cycleMinutes: row.cycle_minutes,
    activityPercent: row.activity_percent,
    maxRefPosts: row.max_ref_posts,
    maxMemoryChars: row.max_memory_chars,
    maxInputTokens: row.max_input_tokens,
    maxOutputTokens: row.max_output_tokens,
    dailyNeuronsLimit: row.daily_neurons_limit,
    dailyRunsLimit: row.daily_runs_limit,
    maxConcurrency: row.max_concurrency,
    modelId: row.model_id,
    promptVersion: row.prompt_version,
  };
}

/** RunSettings（camelCase）を world_settings の更新列（snake_case）に変換する */
export function toWorldSettingsValues(settings: RunSettings, updatedAt: string): Omit<WorldSettingsRow, "world_id"> {
  return {
    cycle_minutes: settings.cycleMinutes,
    activity_percent: settings.activityPercent,
    max_ref_posts: settings.maxRefPosts,
    max_memory_chars: settings.maxMemoryChars,
    max_input_tokens: settings.maxInputTokens,
    max_output_tokens: settings.maxOutputTokens,
    daily_neurons_limit: settings.dailyNeuronsLimit,
    daily_runs_limit: settings.dailyRunsLimit,
    max_concurrency: settings.maxConcurrency,
    model_id: settings.modelId,
    prompt_version: settings.promptVersion,
    updated_at: updatedAt,
  };
}

/**
 * 直近 50 件の成功した LLM 生成（decided_by='llm' かつ status='succeeded'）の neurons の平均。
 * 20 件未満なら DEFAULT_AVG_NEURONS_PER_RUN（16.4）を返す（world 3章・4章 averageNeuronsPerRun）
 */
export function averageNeuronsPerRun(db: DbOrTx): number {
  const rows = db
    .select({ neurons: generation_events.neurons })
    .from(generation_events)
    .where(and(eq(generation_events.decided_by, "llm"), eq(generation_events.status, "succeeded")))
    .orderBy(desc(generation_events.started_at))
    .limit(AVG_NEURONS_SAMPLE_LIMIT)
    .all();
  if (rows.length < AVG_NEURONS_MIN_SAMPLES) {
    return DEFAULT_AVG_NEURONS_PER_RUN;
  }
  const sum = rows.reduce((acc, r) => acc + r.neurons, 0);
  return sum / rows.length;
}

/**
 * 1日の生成回数・Neurons・周期の下限の見込みを計算する（world 4章 estimateDaily、FE admin_control 4章 computeEstimate）
 */
export function estimateDaily(
  settings:
    | Pick<RunSettings, "cycleMinutes" | "activityPercent" | "dailyNeuronsLimit">
    | Pick<WorldSettingsRow, "cycle_minutes" | "activity_percent" | "daily_neurons_limit">,
  avgNeurons: number,
  activeAgents: ReadonlyArray<AgentRow | { activity_level: number }>,
  config: GenerationConfig,
): DailyEstimate {
  const cycleMinutes = "cycleMinutes" in settings ? settings.cycleMinutes : settings.cycle_minutes;
  const activityPercent = "activityPercent" in settings ? settings.activityPercent : settings.activity_percent;
  const dailyNeuronsLimit = "dailyNeuronsLimit" in settings ? settings.dailyNeuronsLimit : settings.daily_neurons_limit;

  const agentCount = activeAgents.length;
  const avgParticipation =
    agentCount === 0
      ? 0
      : activeAgents.reduce((acc, a) => {
          const key = String(a.activity_level) as keyof GenerationConfig["participation"];
          return acc + (config.participation[key] ?? 0);
        }, 0) / agentCount;

  const runsPerCycle = agentCount * (activityPercent / 100) * avgParticipation;
  const cyclesPerDay = MINUTES_PER_DAY / cycleMinutes;
  const dailyRuns = Math.round(runsPerCycle * cyclesPerDay);
  const dailyNeurons = Math.round(runsPerCycle * avgNeurons * cyclesPerDay);

  const neuronsPerCycle = runsPerCycle * avgNeurons;
  const minCycle = SETTINGS_RANGES.cycleMinutes.min;
  const cycleMinutesFloor =
    neuronsPerCycle <= 0
      ? minCycle
      : Math.max(minCycle, Math.ceil(MINUTES_PER_DAY / (dailyNeuronsLimit / neuronsPerCycle)));

  return {
    cycleMinutesFloor,
    dailyRuns,
    dailyNeurons,
    avgParticipation,
  };
}

/**
 * prompts/ の直下のフォルダで、system.md と user.md の両方があるものの名前を名前の順で返す（world 4章 listPromptVersions）
 */
export function listPromptVersions(promptsDir: string = DEFAULT_PROMPTS_DIR): string[] {
  if (!existsSync(promptsDir)) return [];
  const entries = readdirSync(promptsDir, { withFileTypes: true });
  const versions: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = join(promptsDir, entry.name);
    if (existsSync(join(dir, "system.md")) && existsSync(join(dir, "user.md"))) {
      versions.push(entry.name);
    }
  }
  versions.sort();
  return versions;
}

/** 世界の state ごとのエージェント数（world 3章 countAgentsByState。GROUP BY 1回） */
export function countAgentsByState(db: DbOrTx, worldId: string): { active: number; stopped: number } {
  const rows = db
    .select({ state: agents.state, n: count() })
    .from(agents)
    .where(eq(agents.world_id, worldId))
    .groupBy(agents.state)
    .all();
  const counts = { active: 0, stopped: 0 };
  for (const row of rows) {
    if (row.state === "active" || row.state === "stopped") {
      counts[row.state] = row.n;
    }
  }
  return counts;
}

/** 稼働中のエージェント一覧（world 3章 listActiveAgents） */
export function listActiveAgents(db: DbOrTx, worldId: string): AgentRow[] {
  return db
    .select()
    .from(agents)
    .where(and(eq(agents.world_id, worldId), eq(agents.state, "active")))
    .orderBy(agents.created_at)
    .all();
}

function ensureCurrentWorld(db: Db, clock: Clock): WorldRow {
  return findCurrentWorld(db) ?? withTx(db, (tx) => createInitialWorld(tx, clock.now()));
}

/**
 * GET /admin/api/settings：実行設定と、直近の実測からの見込みを返す（world 2章・4章 getSettingsWithEstimate）
 */
export function getSettingsWithEstimate(db: Db, clock: Clock, options: SettingsServiceOptions): SettingsResponse {
  const world = ensureCurrentWorld(db, clock);
  const settingsRow = findWorldSettings(db, world.world_id);
  if (!settingsRow) {
    throw new Error(`world_settings がありません（world_id=${world.world_id}）`);
  }
  const settings = toRunSettings(settingsRow);
  const avgNeurons = averageNeuronsPerRun(db);
  const activeAgentRows = listActiveAgents(db, world.world_id);
  const estimate = estimateDaily(settings, avgNeurons, activeAgentRows, options.generationConfig);
  const promptVersions = listPromptVersions(options.promptsDir);

  return {
    settings,
    avgNeuronsPerRun: avgNeurons,
    activeAgents: activeAgentRows.length,
    avgParticipation: estimate.avgParticipation,
    estimatedCycleMinutes: estimate.cycleMinutesFloor,
    estimatedDailyRuns: estimate.dailyRuns,
    estimatedDailyNeurons: estimate.dailyNeurons,
    modelOptions: [...MODEL_OPTIONS],
    promptVersions,
  };
}

export interface UpdateSettingsDeps {
  scheduler: SchedulerControl;
  worldService: Pick<WorldService, "enterLimitStopped">;
}

/**
 * PUT /admin/api/settings：実行設定を検証・更新し、上限の変更に伴う状態遷移を行う（world 2章・4章 updateSettings）
 */
export async function updateSettings(
  db: Db,
  clock: Clock,
  deps: UpdateSettingsDeps,
  input: unknown,
  admin: WorldAdmin,
  options: SettingsServiceOptions,
): Promise<SettingsUpdateResponse> {
  // 手順 1：SettingsSchema で検証し、promptVersion が listPromptVersions に含まれるか確かめる
  const parsed: SettingsInput = SettingsSchema.parse(input);
  const promptVersions = listPromptVersions(options.promptsDir);
  if (!promptVersions.includes(parsed.promptVersion)) {
    throw new AppError("VALIDATION_ERROR", {
      fields: { promptVersion: "指定されたプロンプトの版が見つかりません" },
    });
  }

  const now = clock.now();
  const nowIso = now.toISOString();
  const newValues = toWorldSettingsValues(parsed, nowIso);

  // 手順 2・3：withTx で world_settings を更新し、監査を記録。limit_stopped → running の復帰も同トランザクションで行う
  const txResult = withTx(db, (tx) => {
    const world = findCurrentWorld(tx);
    if (!world || world.state === "archived") {
      throw new AppError("STATE_CONFLICT");
    }
    const currentSettingsRow = findWorldSettings(tx, world.world_id);
    if (!currentSettingsRow) {
      throw new Error(`world_settings がありません（world_id=${world.world_id}）`);
    }
    const beforeSettings = toRunSettings(currentSettingsRow);

    tx.update(world_settings).set(newValues).where(eq(world_settings.world_id, world.world_id)).run();

    recordAudit(tx, clock, {
      adminId: admin.adminId,
      operation: "settings.update",
      targetType: "settings",
      targetId: world.world_id,
      before: beforeSettings,
      after: parsed,
      worldId: world.world_id,
    });

    const usage = getUsage(tx, utcDate(now));
    const withinNewLimits = isWithinLimits(usage, newValues);
    const exceededReason = limitReason(usage, newValues);

    let resumedFromLimit = false;
    if (
      world.state === "limit_stopped" &&
      (world.stop_reason === "neurons_limit" || world.stop_reason === "runs_limit") &&
      withinNewLimits &&
      canTransition(world.state, "running")
    ) {
      const planned = world.next_cycle_at;
      const nextCycleAt = planned !== null && Date.parse(planned) > now.getTime() ? planned : nowIso;
      const updated = tx
        .update(worlds)
        .set({
          state: "running",
          stop_reason: null,
          running_since: nowIso,
          heartbeat_at: nowIso,
          next_cycle_at: nextCycleAt,
        })
        .where(and(eq(worlds.world_id, world.world_id), eq(worlds.state, "limit_stopped")))
        .run();
      if (updated.changes === 0) {
        throw new AppError("STATE_CONFLICT");
      }
      resumedFromLimit = true;
    }

    return {
      worldId: world.world_id,
      initialState: world.state,
      resumedFromLimit,
      exceededReason,
    };
  });

  let stateChanged: string | null = null;
  if (txResult.resumedFromLimit) {
    deps.scheduler.wake();
    stateChanged = "limit_stopped→running";
  } else if (txResult.initialState === "running" && txResult.exceededReason !== null) {
    // 手順 4：running で新しい上限を超えていれば enterLimitStopped（中で stopAll('limit')）
    await deps.worldService.enterLimitStopped(txResult.exceededReason);
    const afterWorld = findCurrentWorld(db);
    if (afterWorld?.state === "limit_stopped") {
      stateChanged = "running→limit_stopped";
    }
  }

  const avgNeurons = averageNeuronsPerRun(db);
  const activeAgentRows = listActiveAgents(db, txResult.worldId);
  const estimate = estimateDaily(parsed, avgNeurons, activeAgentRows, options.generationConfig);

  return {
    settings: parsed,
    estimatedCycleMinutes: estimate.cycleMinutesFloor,
    estimatedDailyRuns: estimate.dailyRuns,
    stateChanged,
  };
}
