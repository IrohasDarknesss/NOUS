// 管理データのルート 16 本（BE 詳細設計 admin_data 1章・2章。中身は NOUS-64〜NOUS-66）
// adminServer が /admin/api に登録する。パスは /admin/api からの相対で書く（例: dataRoutes.get("/agents", …)）。
// 認証は adminServer で済んでいる（requireAdminSession・requireCsrf は 掛かっている）
import { Hono } from "hono";
import type { AdminEnv } from "../context";

export const dataRoutes = new Hono<AdminEnv>();
