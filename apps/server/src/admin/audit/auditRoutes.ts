// 管理操作履歴のルート（BE 詳細設計 admin_auth 2章 GET /admin/api/audit-logs。中身は NOUS-54）
// adminServer が /admin/api に登録する。パスは /admin/api からの相対で書く（例: auditRoutes.get("/audit-logs", …)）。
// 認証は adminServer で済んでいる（requireAdminSession・requireCsrf は 掛かっている）
import { Hono } from "hono";
import type { AdminEnv } from "../context";

export const auditRoutes = new Hono<AdminEnv>();
