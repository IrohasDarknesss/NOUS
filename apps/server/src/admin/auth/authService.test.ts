import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TEST_ADMIN_ID, TEST_NOW, seedSession } from "../../../test/helpers/adminTestSupport";
import { createTestDb, type TestDb } from "../../../test/helpers/testDb";
import { FakeClock } from "../../clock/fakeClock";
import { admin_account, admin_audit_logs, admin_sessions } from "../../db/schema";
import { AppError } from "../../lib/errors";
import { sha256Hex } from "../../lib/tokens";
import {
  LOCK_DURATION_MS,
  createSession,
  findAdmin,
  getSessionInfo,
  isLocked,
  login,
  logout,
  registerFailure,
} from "./authService";
import { hashPassword } from "./passwordHasher";

const PASSWORD = "correct-password-123";

describe("authService", () => {
  let t: TestDb;
  let clock: FakeClock;

  beforeEach(() => {
    t = createTestDb();
    clock = new FakeClock(TEST_NOW);
  });

  afterEach(() => t.cleanup());

  async function seedAdminWithPassword(password = PASSWORD): Promise<void> {
    const passwordHash = await hashPassword(password);
    t.db
      .insert(admin_account)
      .values({
        admin_id: TEST_ADMIN_ID,
        display_name: "Kaine Yamashiro",
        password_hash: passwordHash,
        failed_count: 0,
        locked_until: null,
        updated_at: TEST_NOW.toISOString(),
      })
      .run();
  }

  it("TC-NOUS53_DEV-04 login は admin_account がなければ 409 ADMIN_NOT_SET を投げる", async () => {
    await expect(login(t.db, clock, PASSWORD)).rejects.toMatchObject({
      code: "ADMIN_NOT_SET",
      status: 409,
    });
  });

  it("TC-NOUS53_DEV-05 login の成功で failed_count と locked_until を初期化し、セッションと admin.login の監査を残す", async () => {
    await seedAdminWithPassword();
    t.db
      .update(admin_account)
      .set({ failed_count: 3, locked_until: new Date(TEST_NOW.getTime() - 1000).toISOString() })
      .run();

    const result = await login(t.db, clock, PASSWORD);
    expect(result.displayName).toBe("Kaine Yamashiro");
    expect(result.sessionId).toHaveLength(43);
    expect(result.csrfToken).toHaveLength(43);

    const admin = findAdmin(t.db);
    expect(admin?.failed_count).toBe(0);
    expect(admin?.locked_until).toBeNull();

    const sessions = t.db.select().from(admin_sessions).all();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      session_hash: sha256Hex(result.sessionId),
      admin_id: TEST_ADMIN_ID,
      csrf_token: result.csrfToken,
      created_at: TEST_NOW.toISOString(),
      last_seen_at: TEST_NOW.toISOString(),
    });

    const audits = t.db.select().from(admin_audit_logs).all();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      admin_id: TEST_ADMIN_ID,
      operation: "admin.login",
      target_type: "admin",
      target_id: TEST_ADMIN_ID,
    });
  });

  it("TC-NOUS53_DEV-06 login の失敗で failed_count を +1 し、admin.login_failed の監査を残して 401 LOGIN_FAILED を投げる", async () => {
    await seedAdminWithPassword();

    await expect(login(t.db, clock, "wrong-password-123")).rejects.toMatchObject({
      code: "LOGIN_FAILED",
      status: 401,
    });
    expect(findAdmin(t.db)?.failed_count).toBe(1);
    expect(findAdmin(t.db)?.locked_until).toBeNull();

    const audits = t.db.select().from(admin_audit_logs).all();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      operation: "admin.login_failed",
      target_type: "admin",
    });
  });

  it("TC-NOUS53_DEV-07 5 回目の失敗で locked_until=現在+15分・failed_count=0 にし、その回は LOGIN_FAILED、次の要求から 429 LOGIN_LOCKED（JST の HH:MM と lockedUntil）、15 分後に解除される", async () => {
    await seedAdminWithPassword();

    for (let i = 1; i <= 5; i += 1) {
      await expect(login(t.db, clock, "wrong-password-123")).rejects.toMatchObject({
        code: "LOGIN_FAILED",
        status: 401,
      });
    }

    const expectedLockedUntil = new Date(TEST_NOW.getTime() + LOCK_DURATION_MS).toISOString();
    const adminAfter5 = findAdmin(t.db);
    expect(adminAfter5?.failed_count).toBe(0);
    expect(adminAfter5?.locked_until).toBe(expectedLockedUntil);
    expect(t.db.select().from(admin_audit_logs).all()).toHaveLength(5);

    // TEST_NOW = 2026-10-20T00:00:00.000Z (JST 09:00) → +15m = 2026-10-20T00:15:00.000Z (JST 09:15)
    let lockedErr: AppError | undefined;
    try {
      await login(t.db, clock, PASSWORD);
    } catch (err) {
      lockedErr = err as AppError;
    }
    expect(lockedErr).toBeInstanceOf(AppError);
    expect(lockedErr?.code).toBe("LOGIN_LOCKED");
    expect(lockedErr?.status).toBe(429);
    expect(lockedErr?.message).toBe("ログインの試行が続いたため、09:15 まで受け付けません");
    expect(lockedErr?.fields).toEqual({ lockedUntil: expectedLockedUntil });

    // 15 分ちょうど経過したらロック解除され、正しいパスワードでログインできる
    await clock.advance(LOCK_DURATION_MS);
    const ok = await login(t.db, clock, PASSWORD);
    expect(ok.displayName).toBe("Kaine Yamashiro");
    expect(findAdmin(t.db)?.locked_until).toBeNull();
  });

  it("TC-NOUS53_DEV-08 isLocked・registerFailure・createSession が単体で仕様どおりに動く", async () => {
    await seedAdminWithPassword();
    const admin = findAdmin(t.db)!;
    expect(isLocked(admin, TEST_NOW)).toBe(false);

    for (let i = 1; i <= 4; i += 1) {
      const r = registerFailure(t.db, findAdmin(t.db)!, TEST_NOW);
      expect(r).toEqual({ locked: false, lockedUntil: null });
    }
    const r5 = registerFailure(t.db, findAdmin(t.db)!, TEST_NOW);
    expect(r5.locked).toBe(true);
    expect(r5.lockedUntil).toBe(new Date(TEST_NOW.getTime() + LOCK_DURATION_MS).toISOString());
    expect(isLocked(findAdmin(t.db)!, TEST_NOW)).toBe(true);
    expect(isLocked(findAdmin(t.db)!, new Date(TEST_NOW.getTime() + LOCK_DURATION_MS))).toBe(false);

    const created = createSession(t.db, TEST_ADMIN_ID, TEST_NOW);
    expect(created.sessionId).toHaveLength(43);
    expect(created.csrfToken).toHaveLength(43);
  });

  it("TC-NOUS53_DEV-09 logout がセッションの行を削除し、admin.logout の監査を残す", async () => {
    await seedAdminWithPassword();
    const s = seedSession(t.db);
    expect(t.db.select().from(admin_sessions).all()).toHaveLength(1);

    logout(t.db, clock, s.sessionHash, TEST_ADMIN_ID);

    expect(t.db.select().from(admin_sessions).all()).toHaveLength(0);
    const audits = t.db.select().from(admin_audit_logs).all();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      admin_id: TEST_ADMIN_ID,
      operation: "admin.logout",
      target_type: "admin",
      target_id: TEST_ADMIN_ID,
    });
  });

  it("TC-NOUS53_DEV-10 getSessionInfo が min(created_at+8時間, 現在+60分) を expiresAt として返す", () => {
    const baseSession = {
      adminId: TEST_ADMIN_ID,
      displayName: "Kaine Yamashiro",
      csrfToken: "csrf-token-43-chars-00000000000000000000000",
      sessionHash: "h",
      createdAt: TEST_NOW.toISOString(),
    };

    // 作成直後：現在+60分の方が早い
    const info1 = getSessionInfo(baseSession, TEST_NOW);
    expect(info1.expiresAt).toBe(new Date(TEST_NOW.getTime() + 60 * 60 * 1000).toISOString());

    // 作成から 7時間30分後：created_at+8時間（あと30分）の方が早い
    const sevenAndHalfHoursLater = new Date(TEST_NOW.getTime() + 7.5 * 60 * 60 * 1000);
    const info2 = getSessionInfo(baseSession, sevenAndHalfHoursLater);
    expect(info2.expiresAt).toBe(new Date(TEST_NOW.getTime() + 8 * 60 * 60 * 1000).toISOString());
  });
});
