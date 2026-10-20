// login・logout・session のルート（BE 詳細設計 admin_auth 2章）
// adminServer が /admin/api に登録する。パスは /admin/api からの相対で書く（例: authRoutes.post("/login", …)）。
// login には requireAdminSession・requireCsrf を掛けていない。GET /session にも掛けていないので、ADMIN_NOT_SET を先に確かめてから
// このファイルで requireAdminSession を通す。logout には両方が掛かっている（adminServer の PUBLIC_ROUTES）
import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";
import { AppError } from "../../lib/errors";
import type { AdminEnv } from "../context";
import { ADMIN_COOKIE, requireAdminSession } from "../middleware/sessionAuth";
import { findAdmin, getSessionInfo, login, logout } from "./authService";

export const LoginInputSchema = z.object({
  password: z
    .string({ required_error: "パスワードを入力してください", invalid_type_error: "パスワードを入力してください" })
    .min(12, "12 字以上で入力してください")
    .max(128, "128 字以内で入力してください"),
});

/** GET /session の先頭で管理者のパスワード設定済みかを確かめる */
const requireAdminAccountSet: MiddlewareHandler<AdminEnv> = async (c, next) => {
  if (!findAdmin(c.var.db)) {
    throw new AppError("ADMIN_NOT_SET");
  }
  await next();
};

export const authRoutes = new Hono<AdminEnv>();

authRoutes.post("/login", async (c) => {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    raw = {};
  }
  const { password } = LoginInputSchema.parse(raw);
  const { sessionId, csrfToken, displayName } = await login(c.var.db, c.var.clock, password);
  c.header("Set-Cookie", `${ADMIN_COOKIE}=${sessionId}; HttpOnly; SameSite=Strict; Path=/`);
  return c.json({ displayName, csrfToken }, 200);
});

authRoutes.post("/logout", (c) => {
  const { sessionHash, adminId } = c.var.admin;
  logout(c.var.db, c.var.clock, sessionHash, adminId);
  c.header("Set-Cookie", `${ADMIN_COOKIE}=; Max-Age=0; Path=/`);
  return c.body(null, 204);
});

authRoutes.get("/session", requireAdminAccountSet, requireAdminSession, (c) => {
  const info = getSessionInfo(c.var.admin, c.var.clock.now());
  return c.json(info, 200);
});
