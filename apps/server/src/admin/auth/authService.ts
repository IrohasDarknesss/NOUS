// 管理者の認証・ロック・セッションの作成と削除（BE 詳細設計 admin_auth 2章・3章・4章・6章）
import { eq } from "drizzle-orm";
import type { Clock } from "../../clock/clock";
import type { Db } from "../../db/client";
import { admin_account, admin_sessions } from "../../db/schema";
import { withTx, type DbOrTx } from "../../db/tx";
import { AppError } from "../../lib/errors";
import { randomToken, sha256Hex } from "../../lib/tokens";
import { recordAudit } from "../audit/auditService";
import type { AdminSession } from "../context";
import { SESSION_ABSOLUTE_MS, SESSION_IDLE_MS } from "../middleware/sessionAuth";
import { verifyPassword } from "./passwordHasher";

/** 連続して失敗したときにロックする回数 */
export const MAX_FAILED_ATTEMPTS = 5;
/** ロックの期間（15 分） */
export const LOCK_DURATION_MS = 15 * 60 * 1000;

export type AdminRow = typeof admin_account.$inferSelect;

export interface LoginResult {
  sessionId: string;
  csrfToken: string;
  displayName: string;
}

export interface RegisterFailureResult {
  locked: boolean;
  lockedUntil: string | null;
}

export interface CreatedSession {
  sessionId: string;
  csrfToken: string;
}

export interface SessionInfo {
  displayName: string;
  csrfToken: string;
  expiresAt: string;
}

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** ISO 文字列の時刻を JST の HH:MM に整形する */
function formatJstHhMm(iso: string): string {
  const jst = new Date(new Date(iso).getTime() + JST_OFFSET_MS);
  const hh = String(jst.getUTCHours()).padStart(2, "0");
  const mm = String(jst.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

/** admin_account を1行読む（3章 findAdmin） */
export function findAdmin(db: DbOrTx): AdminRow | undefined {
  return db.select().from(admin_account).get();
}

/** locked_until があり now より後なら true（4章 isLocked） */
export function isLocked(admin: Pick<AdminRow, "locked_until">, now: Date): boolean {
  if (!admin.locked_until) return false;
  return new Date(admin.locked_until).getTime() > now.getTime();
}

/**
 * 失敗回数を +1 し、5 以上になったら locked_until = now + 15 分、failed_count = 0 にして UPDATE する（4章 registerFailure）
 */
export function registerFailure(db: DbOrTx, admin: AdminRow, now: Date): RegisterFailureResult {
  const nextCount = admin.failed_count + 1;
  const locked = nextCount >= MAX_FAILED_ATTEMPTS;
  const lockedUntil = locked ? new Date(now.getTime() + LOCK_DURATION_MS).toISOString() : null;
  const failedCount = locked ? 0 : nextCount;
  const nowIso = now.toISOString();

  db.update(admin_account)
    .set({
      failed_count: failedCount,
      locked_until: lockedUntil,
      updated_at: nowIso,
    })
    .where(eq(admin_account.admin_id, admin.admin_id))
    .run();

  return { locked, lockedUntil };
}

/**
 * randomToken(32) で sessionId と csrfToken を作り、sha256Hex(sessionId) を session_hash として admin_sessions に INSERT する（4章 createSession）
 */
export function createSession(db: DbOrTx, adminId: string, now: Date): CreatedSession {
  const sessionId = randomToken(32);
  const csrfToken = randomToken(32);
  const sessionHash = sha256Hex(sessionId);
  const nowIso = now.toISOString();

  db.insert(admin_sessions)
    .values({
      session_hash: sessionHash,
      admin_id: adminId,
      csrf_token: csrfToken,
      created_at: nowIso,
      last_seen_at: nowIso,
    })
    .run();

  return { sessionId, csrfToken };
}

/**
 * パスワードを照合して管理セッションを作る（2章 POST /admin/api/login・4章 login・6章 トランザクション制御）。
 * scrypt の計算は非同期のため withTx の外で先に行う。
 */
export async function login(db: Db, clock: Clock, password: string): Promise<LoginResult> {
  const admin = findAdmin(db);
  if (!admin) {
    throw new AppError("ADMIN_NOT_SET");
  }

  const now = clock.now();
  if (isLocked(admin, now) && admin.locked_until) {
    const hhmm = formatJstHhMm(admin.locked_until);
    throw new AppError("LOGIN_LOCKED", {
      message: `ログインの試行が続いたため、${hhmm} まで受け付けません`,
      fields: { lockedUntil: admin.locked_until },
    });
  }

  const verified = await verifyPassword(password, admin.password_hash);
  const txNow = clock.now();

  if (!verified) {
    withTx(db, (tx) => {
      const current = findAdmin(tx) ?? admin;
      registerFailure(tx, current, txNow);
      recordAudit(tx, clock, {
        adminId: current.admin_id,
        operation: "admin.login_failed",
        targetType: "admin",
        targetId: current.admin_id,
      });
    });
    throw new AppError("LOGIN_FAILED");
  }

  return withTx(db, (tx) => {
    const nowIso = txNow.toISOString();
    tx.update(admin_account)
      .set({
        failed_count: 0,
        locked_until: null,
        updated_at: nowIso,
      })
      .where(eq(admin_account.admin_id, admin.admin_id))
      .run();

    const { sessionId, csrfToken } = createSession(tx, admin.admin_id, txNow);
    recordAudit(tx, clock, {
      adminId: admin.admin_id,
      operation: "admin.login",
      targetType: "admin",
      targetId: admin.admin_id,
    });

    return {
      sessionId,
      csrfToken,
      displayName: admin.display_name,
    };
  });
}

/**
 * admin_sessions の行を DELETE し、recordAudit(admin.logout) を同じトランザクションで残す（2章 POST /admin/api/logout・4章 logout）
 */
export function logout(db: Db, clock: Clock, sessionHash: string, adminId: string): void {
  withTx(db, (tx) => {
    tx.delete(admin_sessions).where(eq(admin_sessions.session_hash, sessionHash)).run();
    recordAudit(tx, clock, {
      adminId,
      operation: "admin.logout",
      targetType: "admin",
      targetId: adminId,
    });
  });
}

/**
 * セッションの有効期限 expiresAt = min(created_at + 8 時間, now + 60 分) を求め、displayName・csrfToken と返す（2章 GET /admin/api/session・4章 getSessionInfo）
 */
export function getSessionInfo(session: AdminSession, now: Date): SessionInfo {
  const absoluteExpiresMs = new Date(session.createdAt).getTime() + SESSION_ABSOLUTE_MS;
  const idleExpiresMs = now.getTime() + SESSION_IDLE_MS;
  const expiresAt = new Date(Math.min(absoluteExpiresMs, idleExpiresMs)).toISOString();
  return {
    displayName: session.displayName,
    csrfToken: session.csrfToken,
    expiresAt,
  };
}
