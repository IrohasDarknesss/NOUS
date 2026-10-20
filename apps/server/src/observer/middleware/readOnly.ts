// GET・HEAD 以外を 405 にする（BE 詳細設計 observer 4章 readOnly、6章）
import { createMiddleware } from "hono/factory";
import { AppError } from "../../lib/errors";
import type { Logger } from "../../lib/logger";
import { maskPath, type ObserverEnv } from "../context";

/** 405 の応答の Allow ヘッダー */
export const ALLOWED_METHODS = "GET, HEAD";

/** メソッドが GET・HEAD でなければ 405 WRITE_NOT_ALLOWED（Allow は observerServer の onError で付ける） */
export function readOnly(logger: Logger) {
  return createMiddleware<ObserverEnv>(async (c, next) => {
    const method = c.req.method;
    if (method !== "GET" && method !== "HEAD") {
      logger.info("observer: 書き込みの要求を拒否", { method, path: maskPath(c.req.path) });
      throw new AppError("WRITE_NOT_ALLOWED");
    }
    await next();
  });
}
