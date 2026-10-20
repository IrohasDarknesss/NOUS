// 世界の状態のルート 6 本（BE 詳細設計 world 1章・2章 /admin/api/world*）
// adminServer が /admin/api に登録する。パスは /admin/api からの相対で書く（例: worldRoutes.post("/world/start", …)）。
// 認証は adminServer で済んでいる（requireAdminSession・requireCsrf は掛かっている）
import { fileURLToPath } from "node:url";
import { FREE_TIER_NEURONS, WorldResetRequestSchema, type AdminWorldResponse } from "@nous/shared";
import { Hono, type Context } from "hono";
import { recordAudit } from "../admin/audit/auditService";
import type { AdminEnv } from "../admin/context";
import { utcDate } from "../clock/clock";
import { loadGenerationConfig, type GenerationConfig } from "../config/generationConfig";
import { withTx } from "../db/tx";
import { DEFAULT_PROMPTS_DIR } from "../generation/promptBuilder";
import { AppError } from "../lib/errors";
import type { Logger } from "../lib/logger";
import { countAgentsByState } from "./settingsService";
import {
  countRunningEvents,
  createInitialWorld,
  createWorldService,
  findCurrentWorld,
  findWorldSettings,
  getUsage,
  type SchedulerControl,
  type WorldService,
} from "./worldService";
import { getWorldTimeSec } from "./worldTime";

/** リポジトリ直下の config/generation.json（apps/server/src/world から 4 つ上） */
const DEFAULT_GENERATION_CONFIG_PATH = fileURLToPath(new URL("../../../../config/generation.json", import.meta.url));

export interface WorldApiOptions {
  scheduler?: SchedulerControl;
  generationConfig?: GenerationConfig;
  promptsDir?: string;
}

let configuredOptions: WorldApiOptions = {};
let cachedDefaultGenerationConfig: GenerationConfig | undefined;

/** main.ts から起動時に1回呼ぶ想定（テストからも差し替え用に呼ぶ） */
export function configureWorldApi(options: WorldApiOptions): void {
  configuredOptions = { ...options };
}

/** テスト用に設定を既定へ戻す */
export function resetWorldApi(): void {
  configuredOptions = {};
  cachedDefaultGenerationConfig = undefined;
}

/** 現在の SchedulerControl を返す。未設定なら logger.warn("scheduler_not_configured") を出す仮実装 */
export function resolveScheduler(logger: Logger): SchedulerControl {
  if (configuredOptions.scheduler) {
    return configuredOptions.scheduler;
  }
  return {
    stopAll: async () => {
      logger.warn("scheduler_not_configured");
      return 0;
    },
    wake: () => {
      logger.warn("scheduler_not_configured");
    },
  };
}

/** 現在の GenerationConfig を返す。未設定なら初めて要るときに config/generation.json を読む */
export function resolveGenerationConfig(): GenerationConfig {
  if (configuredOptions.generationConfig) {
    return configuredOptions.generationConfig;
  }
  cachedDefaultGenerationConfig ??= loadGenerationConfig(DEFAULT_GENERATION_CONFIG_PATH);
  return cachedDefaultGenerationConfig;
}

/** 現在の promptsDir を返す。未設定ならリポジトリ直下の prompts/ */
export function resolvePromptsDir(): string {
  return configuredOptions.promptsDir ?? DEFAULT_PROMPTS_DIR;
}

/** 要求のコンテキストから WorldService を組み立てる */
export function buildWorldService(c: Context<AdminEnv>): {
  worldService: WorldService;
  scheduler: SchedulerControl;
} {
  const { db, clock, logger } = c.var;
  const scheduler = resolveScheduler(logger);
  const worldService = createWorldService({
    db,
    clock,
    scheduler,
    recordAudit: (tx, entry) => {
      recordAudit(tx, clock, entry);
    },
    logger,
  });
  return { worldService, scheduler };
}

/** 要求本文を JSON として読む。JSON でなければ VALIDATION_ERROR */
export async function parseJsonBody(c: Context<AdminEnv>): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new AppError("VALIDATION_ERROR", {
      fields: { _: "JSON の形式が正しくありません" },
    });
  }
}

export const worldRoutes = new Hono<AdminEnv>();

// GET /admin/api/world
worldRoutes.get("/world", (c) => {
  const { db, clock } = c.var;
  const now = clock.now();
  const world = findCurrentWorld(db) ?? withTx(db, (tx) => createInitialWorld(tx, now));
  const settings = findWorldSettings(db, world.world_id);
  if (!settings) {
    throw new Error(`world_settings がありません（world_id=${world.world_id}）`);
  }

  const today = utcDate(now);
  const usage = getUsage(db, today);
  const worldTimeSec = getWorldTimeSec(world, now);
  const runningGenerations = countRunningEvents(db, world.world_id);
  const agentCounts = countAgentsByState(db, world.world_id);

  const response: AdminWorldResponse = {
    worldId: world.world_id,
    name: world.name,
    state: world.state,
    stopReason: world.stop_reason,
    worldTimeSec,
    cycleNo: world.cycle_no,
    nextCycleAt: world.next_cycle_at,
    usage: {
      usageDate: today,
      neurons: usage.neurons,
      neuronsLimit: settings.daily_neurons_limit,
      runs: usage.runs,
      runsLimit: settings.daily_runs_limit,
      freeTierNeurons: FREE_TIER_NEURONS,
    },
    runningGenerations,
    agentCounts,
  };
  return c.json(response, 200);
});

// POST /admin/api/world/start
worldRoutes.post("/world/start", (c) => {
  const { worldService } = buildWorldService(c);
  const res = worldService.startWorld(c.var.admin);
  return c.json(res, 200);
});

// POST /admin/api/world/pause
worldRoutes.post("/world/pause", (c) => {
  const { worldService } = buildWorldService(c);
  const res = worldService.pauseWorld(c.var.admin);
  return c.json(res, 200);
});

// POST /admin/api/world/resume
worldRoutes.post("/world/resume", (c) => {
  const { worldService } = buildWorldService(c);
  const res = worldService.resumeWorld(c.var.admin);
  return c.json(res, 200);
});

// POST /admin/api/world/emergency-stop
worldRoutes.post("/world/emergency-stop", async (c) => {
  const { worldService } = buildWorldService(c);
  const res = await worldService.emergencyStopWorld(c.var.admin);
  return c.json(res, 200);
});

// POST /admin/api/world/reset
worldRoutes.post("/world/reset", async (c) => {
  const body = await parseJsonBody(c);
  const { confirmName } = WorldResetRequestSchema.parse(body);
  const { worldService } = buildWorldService(c);
  const res = worldService.resetWorld(c.var.admin, confirmName);
  return c.json(res, 200);
});
