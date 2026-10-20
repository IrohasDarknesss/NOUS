// CSP ほかのヘッダー（BE 詳細設計 observer 4章 securityHeaders）
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import type { ObserverEnv } from "../context";

export const SECURITY_HEADERS = {
  "Content-Security-Policy":
    "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
} as const;

/** 応答にセキュリティのヘッダーを付ける（エラーの応答にも onError から付ける） */
export function applySecurityHeaders(c: Context): void {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    c.header(name, value);
  }
}

/** next の後に、すべての応答へヘッダーを付ける */
export function securityHeaders() {
  return createMiddleware<ObserverEnv>(async (c, next) => {
    await next();
    applySecurityHeaders(c);
  });
}
