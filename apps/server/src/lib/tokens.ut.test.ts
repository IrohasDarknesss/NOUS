// 単体テスト（NOUS-90）。観点表は docs/test/unit/NOUS-90/観点表_lib.json
import { describe, expect, it } from "vitest";
import { randomToken, safeEqual, sha256Hex } from "./tokens";

describe("tokens（単体テスト）", () => {
  it.each([
    [1, 2],
    [33, 44],
  ])(
    "TC-UT_LIB-032 randomToken は bytes に応じた長さの Base64URL をパディングなしで返す（%i バイト）",
    (bytes, length) => {
      const token = randomToken(bytes);

      expect(token).toMatch(new RegExp(`^[A-Za-z0-9_-]{${length}}$`));
    },
  );

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, "32" as unknown as number])(
    "TC-UT_LIB-033 randomToken は負の数・NaN・無限大・数値でない値を RangeError にする（%s）",
    (bytes) => {
      expect(() => randomToken(bytes)).toThrow(RangeError);
    },
  );

  it("TC-UT_LIB-034 sha256Hex は文字列を UTF-8 として計算する", () => {
    expect(sha256Hex("あ")).toBe("dc5a4d3d82f7e15792959dc661538ae0e541ce66494516f5c9cfd9cd3308494d");
  });

  it("TC-UT_LIB-035 safeEqual は空の文字列どうしを一致とする", () => {
    expect(safeEqual("", "")).toBe(true);
  });

  it("TC-UT_LIB-036 safeEqual は字数が同じでもバイト数が違えば、例外にせず不一致とする", () => {
    expect(safeEqual("あ", "a")).toBe(false);
    expect(safeEqual("a", "あ")).toBe(false);
  });

  it("TC-UT_LIB-037 safeEqual はバイト数が同じで中身が違えば不一致とする", () => {
    expect(safeEqual("あ", "abc")).toBe(false);
  });
});
