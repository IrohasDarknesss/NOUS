import { describe, expect, it } from "vitest";
import { randomToken, safeEqual, sha256Hex } from "./tokens.js";

describe("tokens", () => {
  it("TC-NOUS44_DEV-09 randomToken(32) が 43 字の Base64URL を返す", () => {
    const token = randomToken(32);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomToken()).toHaveLength(43);
    expect(randomToken(32)).not.toBe(token);
  });

  it("TC-NOUS44_DEV-10 randomToken が 1 未満・整数でない bytes を拒む", () => {
    expect(() => randomToken(0)).toThrow(RangeError);
    expect(() => randomToken(1.5)).toThrow(RangeError);
  });

  it("TC-NOUS44_DEV-11 sha256Hex が 64 字の 16 進を返す", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256Hex("")).toHaveLength(64);
  });

  it("TC-NOUS44_DEV-12 safeEqual が一致・不一致・長さ違いを判定する", () => {
    expect(safeEqual("token-a", "token-a")).toBe(true);
    expect(safeEqual("token-a", "token-b")).toBe(false);
    expect(safeEqual("token-a", "token-ab")).toBe(false);
  });
});
