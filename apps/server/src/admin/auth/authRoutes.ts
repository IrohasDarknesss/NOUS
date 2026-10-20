// login・logout・session のルート（BE 詳細設計 admin_auth 2章。中身は NOUS-53）
// adminServer が /admin/api に登録する。パスは /admin/api からの相対で書く（例: authRoutes.post("/login", …)）。
// login には requireAdminSession・requireCsrf を掛けていない。GET /session にも掛けていないので、ADMIN_NOT_SET を先に確かめてから
// このファイルで requireAdminSession を通す。logout には両方が掛かっている（adminServer の PUBLIC_ROUTES）
import { Hono } from "hono";
import type { AdminEnv } from "../context";

export const authRoutes = new Hono<AdminEnv>();
