// 管理セッションの検証（BE 詳細設計 admin_auth 3章 findActiveSession・deleteExpiredSessions、4章 requireAdminSession）
import { and, eq, gt, lte, or } from "drizzle-orm";
import type { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import type { Clock } from "../../clock/clock";
import { admin_account, admin_sessions } from "../../db/schema";
import type { DbOrTx } from "../../db/tx";
import { AppError } from "../../lib/errors";
import { sha256Hex } from "../../lib/tokens";
import type { AdminEnv, AdminSession } from "../context";

/** 管理セッションの Cookie の名前 */
export const ADMIN_COOKIE = "aisns_admin";
/** 作成からの有効期間（8 時間） */
export const SESSION_ABSOLUTE_MS = 8 * 60 * 60 * 1000;
/** 最終操作からの有効期間（60 分） */
export const SESSION_IDLE_MS = 60 * 60 * 1000;

const isoBefore = (now: Date, ms: number): string => new Date(now.getTime() - ms).toISOString();

/** session_hash で、作成から 8 時間・最終操作から 60 分以内のセッションを読む（管理者の表示名と JOIN で1回） */
export function findActiveSession(db: DbOrTx, sessionHash: string, now: Date): AdminSession | undefined {
  const row = db
    .select({
      adminId: admin_sessions.admin_id,
      displayName: admin_account.display_name,
      csrfToken: admin_sessions.csrf_token,
      sessionHash: admin_sessions.session_hash,
      createdAt: admin_sessions.created_at,
    })
    .from(admin_sessions)
    .innerJoin(admin_account, eq(admin_account.admin_id, admin_sessions.admin_id))
    .where(
      and(
        eq(admin_sessions.session_hash, sessionHash),
        gt(admin_sessions.created_at, isoBefore(now, SESSION_ABSOLUTE_MS)),
        gt(admin_sessions.last_seen_at, isoBefore(now, SESSION_IDLE_MS)),
      ),
    )
    .get();
  return row;
}

/** 最終操作時刻を更新する */
export function touchSession(db: DbOrTx, sessionHash: string, now: Date): void {
  db.update(admin_sessions)
    .set({ last_seen_at: now.toISOString() })
    .where(eq(admin_sessions.session_hash, sessionHash))
    .run();
}

/** 失効したセッションを一括で消し、消した件数を返す（5章の定期の削除） */
export function deleteExpiredSessions(db: DbOrTx, clock: Clock): number {
  const now = clock.now();
  const result = db
    .delete(admin_sessions)
    .where(
      or(
        lte(admin_sessions.created_at, isoBefore(now, SESSION_ABSOLUTE_MS)),
        lte(admin_sessions.last_seen_at, isoBefore(now, SESSION_IDLE_MS)),
      ),
    )
    .run();
  return result.changes;
}

/**
 * Cookie aisns_admin の値を sha256Hex して有効なセッションを探し、なければ 401 ADMIN_UNAUTHORIZED。
 * あれば last_seen_at を更新し、c.set('admin', …) して次へ進む
 */
export const requireAdminSession: MiddlewareHandler<AdminEnv> = async (c, next) => {
  const cookie = getCookie(c, ADMIN_COOKIE);
  if (!cookie) {
    throw new AppError("ADMIN_UNAUTHORIZED");
  }
  const { db, clock } = c.var;
  const now = clock.now();
  const session = findActiveSession(db, sha256Hex(cookie), now);
  if (!session) {
    throw new AppError("ADMIN_UNAUTHORIZED");
  }
  touchSession(db, session.sessionHash, now);
  c.set("admin", session);
  await next();
};
