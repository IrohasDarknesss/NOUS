// 世界の状態のルート 6 本（BE 詳細設計 world 1章・2章 /admin/api/world*。中身は NOUS-58）
// adminServer が /admin/api に登録する。パスは /admin/api からの相対で書く（例: worldRoutes.post("/world/start", …)）。
// 認証は adminServer で済んでいる（requireAdminSession・requireCsrf は 掛かっている）
import { Hono } from "hono";
import type { AdminEnv } from "../admin/context";

export const worldRoutes = new Hono<AdminEnv>();
