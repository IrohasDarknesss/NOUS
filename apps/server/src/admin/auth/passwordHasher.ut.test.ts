// 単体テスト（NOUS-91）。観点表は docs/test/unit/NOUS-91/観点表_auth.json
import { beforeAll, describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./passwordHasher";

const PASSWORD = "valid-password-123";

describe("passwordHasher（単体テスト）", () => {
  let salt = "";
  let hash = "";

  beforeAll(async () => {
    [, , , , salt = "", hash = ""] = (await hashPassword(PASSWORD)).split("$");
  });

  it.each([
    ["r が違う", () => `scrypt$16384$16$1$${salt}$${hash}`],
    ["p が違う", () => `scrypt$16384$8$2$${salt}$${hash}`],
    ["7 つに分かれる", () => `scrypt$16384$8$1$${salt}$${hash}$x`],
    ["ソルトのパディングを欠く", () => `scrypt$16384$8$1$${salt.replace(/=+$/, "")}$${hash}`],
    ["ハッシュの前後に空白", () => `scrypt$16384$8$1$${salt}$ ${hash}`],
  ])("TC-UT_AUTH-001 保存の形が少しでも違えば、正しいパスワードでも例外にせず false（%s）", async (_label, stored) => {
    await expect(verifyPassword(PASSWORD, stored())).resolves.toBe(false);
  });

  it("TC-UT_AUTH-002 日本語と絵文字を含むパスワードもハッシュして照合できる", async () => {
    const password = "かいね🙂パスワード1234";

    const stored = await hashPassword(password);

    await expect(verifyPassword(password, stored)).resolves.toBe(true);
    await expect(verifyPassword("かいね🙂パスワード123", stored)).resolves.toBe(false);
  });

  it("TC-UT_AUTH-003 前後の空白・大文字小文字の違いは別のパスワードとする", async () => {
    const stored = `scrypt$16384$8$1$${salt}$${hash}`;

    await expect(verifyPassword(` ${PASSWORD}`, stored)).resolves.toBe(false);
    await expect(verifyPassword(PASSWORD.toUpperCase(), stored)).resolves.toBe(false);
    await expect(verifyPassword(PASSWORD, stored)).resolves.toBe(true);
  });
});
