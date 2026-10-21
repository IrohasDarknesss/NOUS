// 実行設定のルート 2 本（BE 詳細設計 world 1章・2章 /admin/api/settings）
// adminServer が /admin/api に登録する。パスは /admin/api からの相対で書く（例: settingsRoutes.put("/settings", …)）。
// 認証は adminServer で済んでいる（requireAdminSession・requireCsrf は掛かっている）
import { Hono } from "hono";
import type { AdminEnv } from "../admin/context";
import { getSettingsWithEstimate, updateSettings } from "./settingsService";
import { buildWorldService, parseJsonBody, resolveGenerationConfig, resolvePromptsDir } from "./worldRoutes";

export const settingsRoutes = new Hono<AdminEnv>();

// GET /admin/api/settings
settingsRoutes.get("/settings", (c) => {
  const { db, clock } = c.var;
  const res = getSettingsWithEstimate(db, clock, {
    generationConfig: resolveGenerationConfig(),
    promptsDir: resolvePromptsDir(),
  });
  return c.json(res, 200);
});

// PUT /admin/api/settings
settingsRoutes.put("/settings", async (c) => {
  const body = await parseJsonBody(c);
  const { db, clock, admin } = c.var;
  const { worldService, scheduler } = buildWorldService(c);
  const res = await updateSettings(db, clock, { scheduler, worldService }, body, admin, {
    generationConfig: resolveGenerationConfig(),
    promptsDir: resolvePromptsDir(),
  });
  return c.json(res, 200);
});
