// 管理サーバーの Hono の型と、ルートから使う依存（BE 詳細設計 admin_auth 1章・2章「共通の決まり」）
// 各ルーターは new Hono<AdminEnv>() で作り、c.var.db・c.var.clock・c.var.logger・c.var.admin を使う
import type { Clock } from "../clock/clock";
import type { Db } from "../db/client";
import type { Logger } from "../lib/logger";

/** requireAdminSession を通った要求の管理者 */
export interface AdminSession {
  adminId: string;
  displayName: string;
  csrfToken: string;
  /** admin_sessions.session_hash（logout で行を消すのに使う） */
  sessionHash: string;
  /** admin_sessions.created_at（getSessionInfo の期限の計算に使う） */
  createdAt: string;
}

export interface AdminDeps {
  db: Db;
  clock: Clock;
  logger: Logger;
}

export interface AdminEnv {
  Variables: AdminDeps & { admin: AdminSession };
}
