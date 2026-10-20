// 変更の要求の CSRF の検証（BE 詳細設計 admin_auth 4章 requireCsrf、6章「時間一定の比較」）
import type { MiddlewareHandler } from "hono";
import { AppError } from "../../lib/errors";
import { safeEqual } from "../../lib/tokens";
import type { AdminEnv } from "../context";

export const CSRF_HEADER = "X-CSRF-Token";

const SAFE_METHODS = new Set(["GET", "HEAD"]);

/**
 * GET・HEAD はそのまま通す。それ以外は X-CSRF-Token とセッションの csrf_token を時間一定で比べ、違えば 403 CSRF_INVALID。
 * requireAdminSession の後に置く（c.var.admin を使う）
 */
export const requireCsrf: MiddlewareHandler<AdminEnv> = async (c, next) => {
  if (SAFE_METHODS.has(c.req.method)) {
    await next();
    return;
  }
  const header = c.req.header(CSRF_HEADER);
  const admin = c.get("admin");
  if (!header || !admin || !safeEqual(header, admin.csrfToken)) {
    throw new AppError("CSRF_INVALID");
  }
  await next();
};
