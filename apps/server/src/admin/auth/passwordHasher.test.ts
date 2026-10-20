import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./passwordHasher";

describe("passwordHasher", () => {
  it("TC-NOUS53_DEV-01 hashPassword が scrypt$16384$8$1$<16バイトBase64>$<64バイトBase64> の文字列を返し、毎回ソルトが変わる", async () => {
    const h1 = await hashPassword("correct-horse-battery");
    const h2 = await hashPassword("correct-horse-battery");
    expect(h1).not.toBe(h2);

    const parts = h1.split("$");
    expect(parts).toHaveLength(6);
    expect(parts.slice(0, 4)).toEqual(["scrypt", "16384", "8", "1"]);
    const salt = Buffer.from(parts[4] ?? "", "base64");
    const hash = Buffer.from(parts[5] ?? "", "base64");
    expect(salt).toHaveLength(16);
    expect(hash).toHaveLength(64);
  });

  it("TC-NOUS53_DEV-02 verifyPassword が一致するパスワードで true、違うパスワードで false を返す", async () => {
    const stored = await hashPassword("my-secret-password-123");
    expect(await verifyPassword("my-secret-password-123", stored)).toBe(true);
    expect(await verifyPassword("wrong-secret-password", stored)).toBe(false);
  });

  it("TC-NOUS53_DEV-03 verifyPassword は stored の形式が不正なら例外にせず false を返す", async () => {
    const valid = await hashPassword("valid-password-123");
    const [, , , , validSalt, validHash] = valid.split("$");
    const badInputs = [
      "",
      "not-a-hash",
      "scrypt$16384$8$1$only-five",
      `bcrypt$16384$8$1$${validSalt}$${validHash}`,
      `scrypt$1024$8$1$${validSalt}$${validHash}`,
      `scrypt$abc$8$1$${validSalt}$${validHash}`,
      "scrypt$16384$8$1$x$y",
      `scrypt$16384$8$1$${Buffer.alloc(8).toString("base64")}$${validHash}`,
      `scrypt$16384$8$1$${validSalt}$${Buffer.alloc(32).toString("base64")}`,
    ];
    for (const bad of badInputs) {
      await expect(verifyPassword("valid-password-123", bad)).resolves.toBe(false);
    }
  });
});
