// 単体テスト（NOUS-91）。観点表は docs/test/unit/NOUS-91/観点表_auth.json
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TEST_ADMIN_ID, TEST_NOW } from "../../../test/helpers/adminTestSupport";
import { createTestDb, type TestDb } from "../../../test/helpers/testDb";
import { FakeClock } from "../../clock/fakeClock";
import { admin_account, admin_audit_logs, admin_sessions } from "../../db/schema";
import { AppError } from "../../lib/errors";
import { sha256Hex } from "../../lib/tokens";
import { SESSION_ABSOLUTE_MS, SESSION_IDLE_MS } from "../middleware/sessionAuth";
import { LOCK_DURATION_MS, findAdmin, getSessionInfo, isLocked, login, logout, registerFailure } from "./authService";
import { hashPassword } from "./passwordHasher";

const PASSWORD = "correct-password-123";
const WRONG = "wrong-password-0000";
const MIN = 60 * 1000;

describe("authService（単体テスト）", () => {
  let t: TestDb;
  let clock: FakeClock;
  let passwordHash: string;

  beforeAll(async () => {
    passwordHash = await hashPassword(PASSWORD);
  });

  beforeEach(() => {
    t = createTestDb();
    clock = new FakeClock(TEST_NOW);
  });

  afterEach(() => t.cleanup());

  function seedAdmin(values: { failed_count?: number; locked_until?: string | null } = {}): void {
    t.db
      .insert(admin_account)
      .values({
        admin_id: TEST_ADMIN_ID,
        display_name: "Kaine Yamashiro",
        password_hash: passwordHash,
        failed_count: values.failed_count ?? 0,
        locked_until: values.locked_until ?? null,
        updated_at: TEST_NOW.toISOString(),
      })
      .run();
  }

  const admin = () => findAdmin(t.db)!;
  const audits = () =>
    t.db
      .select()
      .from(admin_audit_logs)
      .all()
      .map((r) => r.operation);

  async function loginError(password: string): Promise<AppError> {
    try {
      await login(t.db, clock, password);
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      return err as AppError;
    }
    throw new Error("login が例外を投げなかった");
  }

  it.each([
    ["locked_until がない", null, false],
    ["locked_until が今と同じ時刻", TEST_NOW.toISOString(), false],
    ["locked_until が今の 1 ms 後", new Date(TEST_NOW.getTime() + 1).toISOString(), true],
  ])("TC-UT_AUTH-004 isLocked は locked_until が今より後のときだけ真（%s）", (_label, lockedUntil, expected) => {
    expect(isLocked({ locked_until: lockedUntil }, TEST_NOW)).toBe(expected);
  });

  it("TC-UT_AUTH-005 4 回目の失敗ではロックせず、failed_count を 4 にする", () => {
    seedAdmin({ failed_count: 3 });

    const result = registerFailure(t.db, admin(), TEST_NOW);

    expect(result).toEqual({ locked: false, lockedUntil: null });
    expect(admin()).toMatchObject({ failed_count: 4, locked_until: null });
  });

  it("TC-UT_AUTH-006 ロック中は正しいパスワードでも 429 にし、照合も失敗の数え上げも監査もしない", async () => {
    const lockedUntil = new Date(TEST_NOW.getTime() + 10 * MIN).toISOString();
    seedAdmin({ failed_count: 0, locked_until: lockedUntil });

    const err = await loginError(PASSWORD);

    expect(err.code).toBe("LOGIN_LOCKED");
    expect(err.status).toBe(429);
    expect(admin()).toMatchObject({ failed_count: 0, locked_until: lockedUntil });
    expect(audits()).toEqual([]);
    expect(t.db.select().from(admin_sessions).all()).toHaveLength(0);
  });

  it("TC-UT_AUTH-007 locked_until ちょうどの時刻には正しいパスワードで入れ、ロックを解く", async () => {
    seedAdmin({ locked_until: TEST_NOW.toISOString() });

    const result = await login(t.db, clock, PASSWORD);

    expect(result.displayName).toBe("Kaine Yamashiro");
    expect(admin()).toMatchObject({ failed_count: 0, locked_until: null });
  });

  it("TC-UT_AUTH-008 ロックが明けたあとの 1 回の失敗では、すぐにはロックしない（数え直しは 1 から）", async () => {
    seedAdmin({ failed_count: 0, locked_until: new Date(TEST_NOW.getTime() - 1).toISOString() });

    const err = await loginError(WRONG);

    expect(err.code).toBe("LOGIN_FAILED");
    expect(admin().failed_count).toBe(1);
    expect(isLocked(admin(), TEST_NOW)).toBe(false);
  });

  it("TC-UT_AUTH-009 解除の時刻は JST の HH:MM で、日付をまたぐときも 0 時台で表す", async () => {
    const lockedUntil = "2026-10-19T15:05:00.000Z";
    seedAdmin({ locked_until: lockedUntil });
    clock = new FakeClock(new Date("2026-10-19T14:55:00.000Z"));

    const err = await loginError(PASSWORD);

    expect(err.message).toBe("ログインの試行が続いたため、00:05 まで受け付けません");
    expect(err.fields).toEqual({ lockedUntil });
  });

  it("TC-UT_AUTH-010 成功したら、それまでの失敗の数を 0 に戻す", async () => {
    seedAdmin({ failed_count: 3 });

    await login(t.db, clock, PASSWORD);

    expect(admin().failed_count).toBe(0);
    expect(audits()).toEqual(["admin.login"]);
  });

  it("TC-UT_AUTH-011 続けてログインするとセッションが別々にでき、どちらも session_hash は sessionId の SHA-256", async () => {
    seedAdmin();

    const first = await login(t.db, clock, PASSWORD);
    const second = await login(t.db, clock, PASSWORD);

    expect(first.sessionId).not.toBe(second.sessionId);
    const hashes = t.db
      .select()
      .from(admin_sessions)
      .all()
      .map((r) => r.session_hash)
      .sort();
    expect(hashes).toEqual([sha256Hex(first.sessionId), sha256Hex(second.sessionId)].sort());
  });

  it("TC-UT_AUTH-012 logout は指定のセッションだけを消し、ほかのセッションは残す", async () => {
    seedAdmin();
    const keep = await login(t.db, clock, PASSWORD);
    const drop = await login(t.db, clock, PASSWORD);

    logout(t.db, clock, sha256Hex(drop.sessionId), TEST_ADMIN_ID);

    const rest = t.db
      .select()
      .from(admin_sessions)
      .all()
      .map((r) => r.session_hash);
    expect(rest).toEqual([sha256Hex(keep.sessionId)]);
  });

  it.each([
    ["作成から 7 時間（両方が同じ時刻）", 7 * 60, SESSION_ABSOLUTE_MS],
    ["作成から 7 時間半（8 時間の側）", 7 * 60 + 30, SESSION_ABSOLUTE_MS],
    ["作成から 30 分（60 分の側）", 30, 30 * MIN + SESSION_IDLE_MS],
  ])(
    "TC-UT_AUTH-013 getSessionInfo の expiresAt は 8 時間と 60 分の早いほう（%s）",
    (_label, ageMin, expiresFromCreated) => {
      const createdAt = TEST_NOW.toISOString();
      const now = new Date(TEST_NOW.getTime() + ageMin * MIN);

      const info = getSessionInfo(
        { adminId: TEST_ADMIN_ID, displayName: "Kaine Yamashiro", csrfToken: "c", sessionHash: "h", createdAt },
        now,
      );

      expect(info.expiresAt).toBe(new Date(TEST_NOW.getTime() + expiresFromCreated).toISOString());
    },
  );

  it("TC-UT_AUTH-014 ロックの期間は 15 分で、5 回目の失敗の時刻から数える", async () => {
    seedAdmin({ failed_count: 4 });
    await clock.advance(3 * MIN);

    await loginError(WRONG);

    const row = t.db.select().from(admin_account).where(eq(admin_account.admin_id, TEST_ADMIN_ID)).get();
    expect(row?.locked_until).toBe(new Date(TEST_NOW.getTime() + 3 * MIN + LOCK_DURATION_MS).toISOString());
    expect(LOCK_DURATION_MS).toBe(15 * MIN);
  });
});
