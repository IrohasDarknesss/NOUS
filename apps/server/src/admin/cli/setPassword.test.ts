import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TEST_ADMIN_ID, TEST_NOW, seedAdmin, seedSession } from "../../../test/helpers/adminTestSupport";
import { createTestDb, type TestDb } from "../../../test/helpers/testDb";
import { FakeClock } from "../../clock/fakeClock";
import { admin_account, admin_sessions } from "../../db/schema";
import { isUlid } from "../../lib/ids";
import { findAdmin } from "../auth/authService";
import { verifyPassword } from "../auth/passwordHasher";
import {
  DEFAULT_ADMIN_DISPLAY_NAME,
  readTwoPasswordsHidden,
  setAdminPassword,
  setPasswordCli,
  validatePasswordInput,
} from "./setPassword";

describe("setPassword", () => {
  let t: TestDb;
  let clock: FakeClock;

  beforeEach(() => {
    t = createTestDb();
    clock = new FakeClock(TEST_NOW);
  });

  afterEach(() => t.cleanup());

  it("TC-NOUS53_DEV-18 setAdminPassword は admin_account がなければ新規作成（ULID・Kaine Yamashiro）する", async () => {
    const result = await setAdminPassword(t.db, clock, "initial-password-123");
    expect(result.created).toBe(true);
    expect(isUlid(result.adminId)).toBe(true);

    const row = findAdmin(t.db);
    expect(row).toBeDefined();
    expect(row?.admin_id).toBe(result.adminId);
    expect(row?.display_name).toBe(DEFAULT_ADMIN_DISPLAY_NAME);
    expect(row?.failed_count).toBe(0);
    expect(row?.locked_until).toBeNull();
    expect(row?.updated_at).toBe(TEST_NOW.toISOString());
    expect(await verifyPassword("initial-password-123", row!.password_hash)).toBe(true);
  });

  it("TC-NOUS53_DEV-19 setAdminPassword は既存の admin_account を更新し、failed_count=0・locked_until=NULL に戻して全セッションを削除する", async () => {
    seedAdmin(t.db);
    t.db.update(admin_account).set({ failed_count: 4, locked_until: "2026-10-20T00:15:00.000Z" }).run();
    seedSession(t.db);
    seedSession(t.db);
    expect(t.db.select().from(admin_sessions).all()).toHaveLength(2);

    await clock.advance(60 * 1000);
    const result = await setAdminPassword(t.db, clock, "updated-password-456");
    expect(result).toEqual({ adminId: TEST_ADMIN_ID, created: false });

    const row = findAdmin(t.db);
    expect(row?.failed_count).toBe(0);
    expect(row?.locked_until).toBeNull();
    expect(row?.updated_at).toBe(new Date(TEST_NOW.getTime() + 60 * 1000).toISOString());
    expect(await verifyPassword("updated-password-456", row!.password_hash)).toBe(true);
    expect(t.db.select().from(admin_sessions).all()).toHaveLength(0);
  });

  it("TC-NOUS53_DEV-20 validatePasswordInput と setPasswordCli が不一致・12字未満・129字以上を拒み、終了コード 1 とエラーメッセージ（パスワード値を含まない）を返す", async () => {
    expect(validatePasswordInput("password-1234", "password-5678").ok).toBe(false);
    expect(validatePasswordInput("short-123", "short-123").ok).toBe(false);
    expect(validatePasswordInput("a".repeat(129), "a".repeat(129)).ok).toBe(false);
    expect(validatePasswordInput("valid-password-123", "valid-password-123")).toEqual({ ok: true });

    const errors: string[] = [];
    const code = await setPasswordCli({
      readPasswords: async () => ["secret-value-123", "secret-value-999"],
      stderr: (msg) => errors.push(msg),
      env: { NODE_ENV: "test", AISNS_DB_PATH: t.path },
    });
    expect(code).toBe(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]).not.toContain("secret-value");
  });

  it("TC-NOUS53_DEV-21 setPasswordCli が正常入力で DB に保存して終了コード 0 を返し、readTwoPasswordsHidden は入力文字をエコーしない", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    let echoed = "";
    output.on("data", (chunk: Buffer) => {
      echoed += chunk.toString("utf8");
    });

    const reading = readTwoPasswordsHidden(input, output);
    input.write("cli-secret-password-123\ncli-secret-password-123\n");
    const pair = await reading;
    expect(pair).toEqual(["cli-secret-password-123", "cli-secret-password-123"]);
    expect(echoed).not.toContain("cli-secret-password-123");

    const outs: string[] = [];
    const code = await setPasswordCli({
      readPasswords: async () => pair,
      stdout: (msg) => outs.push(msg),
      env: { NODE_ENV: "test", AISNS_DB_PATH: t.path },
    });
    expect(code).toBe(0);
    expect(outs[0]).not.toContain("cli-secret-password-123");
    expect(await verifyPassword("cli-secret-password-123", findAdmin(t.db)!.password_hash)).toBe(true);
  });

  it("TC-NOUS53_DEV-22 readTwoPasswordsHidden は Ctrl+C（\\u0003）が押されたら rl を閉じて reject する", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const reading = readTwoPasswordsHidden(input, output);
    input.write("\u0003");
    await expect(reading).rejects.toThrow("パスワードの入力が中断されました");
  });

  it("TC-NOUS53_DEV-23 readTwoPasswordsHidden は入力が途中で終了（input.end()）したら reject する", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const reading = readTwoPasswordsHidden(input, output);
    input.write("first-line-only\n");
    input.end();
    await expect(reading).rejects.toThrow("パスワードの入力が途中で終了しました");
  });
});
