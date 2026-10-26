// 単体テスト（NOUS-91）。観点表は docs/test/unit/NOUS-91/観点表_auth.json
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TEST_NOW } from "../../../test/helpers/adminTestSupport";
import { createTestDb, type TestDb } from "../../../test/helpers/testDb";
import { FakeClock } from "../../clock/fakeClock";
import { ConfigError } from "../../lib/errors";
import { login } from "../auth/authService";
import { readTwoPasswordsHidden, setAdminPassword, setPasswordCli, validatePasswordInput } from "./setPassword";

describe("setPassword（単体テスト）", () => {
  it.each([
    ["12 字", "a".repeat(12), true],
    ["128 字", "a".repeat(128), true],
    ["11 字", "a".repeat(11), false],
    ["129 字", "a".repeat(129), false],
    ["日本語 12 字", "あ".repeat(12), true],
  ])("TC-UT_AUTH-020 validatePasswordInput の長さの境界（%s）", (_label, password, ok) => {
    expect(validatePasswordInput(password, password).ok).toBe(ok);
  });

  it("TC-UT_AUTH-021 2 回の入力が違えば、長さより先に「一致しません」を返す", () => {
    expect(validatePasswordInput("short", "other")).toEqual({ ok: false, reason: "パスワードが一致しません" });
  });

  describe("DB を使うもの", () => {
    let t: TestDb;

    beforeEach(() => {
      t = createTestDb();
    });

    afterEach(() => t.cleanup());

    it("TC-UT_AUTH-022 パスワードを設定し直すと、新しいパスワードで入れて、古いパスワードでは入れない", async () => {
      const clock = new FakeClock(TEST_NOW);
      await setAdminPassword(t.db, clock, "old-password-1234");

      const result = await setAdminPassword(t.db, clock, "new-password-5678");

      expect(result.created).toBe(false);
      await expect(login(t.db, clock, "new-password-5678")).resolves.toMatchObject({ displayName: "Kaine Yamashiro" });
      await expect(login(t.db, clock, "old-password-1234")).rejects.toMatchObject({ code: "LOGIN_FAILED" });
    });
  });

  describe("setPasswordCli", () => {
    let dir: string;

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), "nous-setpassword-ut-"));
    });

    afterEach(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    it("TC-UT_AUTH-023 入力の検証に失敗したら DB のファイルを作らずに終了コード 1 を返す", async () => {
      const dbPath = join(dir, "nous.db");
      const errs: string[] = [];

      const code = await setPasswordCli({
        readPasswords: async () => ["short", "short"],
        stderr: (msg) => errs.push(msg),
        env: { NODE_ENV: "test", AISNS_DB_PATH: dbPath },
      });

      expect(code).toBe(1);
      expect(errs).toEqual(["パスワードは 12 字以上で入力してください"]);
      expect(existsSync(dbPath)).toBe(false);
    });

    it("TC-UT_AUTH-024 環境変数が不正なら ConfigError で止まり、DB のファイルを作らない", async () => {
      const dbPath = join(dir, "nous.db");

      const running = setPasswordCli({
        readPasswords: async () => ["cli-secret-password-123", "cli-secret-password-123"],
        env: { NODE_ENV: "test", AISNS_DB_PATH: dbPath, AISNS_ADMIN_PORT: "abc" },
      });

      await expect(running).rejects.toBeInstanceOf(ConfigError);
      await expect(running).rejects.not.toThrow("cli-secret-password-123");
      expect(existsSync(dbPath)).toBe(false);
    });
  });

  describe("readTwoPasswordsHidden", () => {
    it("TC-UT_AUTH-025 2 行がまとめて届いても、1 行目と 2 行目に分けて返し、プロンプトを 2 回出す", async () => {
      const input = new PassThrough();
      const output = new PassThrough();
      let shown = "";
      output.on("data", (chunk: Buffer) => {
        shown += chunk.toString("utf8");
      });
      input.write("first-password-123\nsecond-password-45\n");

      const pair = await readTwoPasswordsHidden(input, output);

      expect(pair).toEqual(["first-password-123", "second-password-45"]);
      expect(shown).toContain("新しいパスワード（12〜128 字）: ");
      expect(shown).toContain("新しいパスワード（確認）: ");
    });

    it("TC-UT_AUTH-026 何も入力せずに入力が終わったら、1 行目の前で reject する", async () => {
      const input = new PassThrough();
      const output = new PassThrough();

      const reading = readTwoPasswordsHidden(input, output);
      input.end();

      await expect(reading).rejects.toThrow("パスワードの入力が途中で終了しました");
    });
  });
});
