// 単体テスト（NOUS-90）。観点表は docs/test/unit/NOUS-90/観点表_lib.json
import { decodeTime } from "ulid";
import { describe, expect, it } from "vitest";
import { isUlid, newUlid } from "./ids";

describe("ids（単体テスト）", () => {
  it("TC-UT_LIB-025 時刻 0 を渡すと、時刻の部分が 0000000000 の ULID になる", () => {
    const id = newUlid(0);

    expect(id.slice(0, 10)).toBe("0000000000");
    expect(decodeTime(id)).toBe(0);
    expect(isUlid(id)).toBe(true);
  });

  it("TC-UT_LIB-026 同じ時刻を続けて渡しても、ちがう ULID になる（FakeClock で時刻が止まっているとき）", () => {
    const t = Date.UTC(2026, 9, 22, 9, 0, 0);

    const ids = Array.from({ length: 100 }, () => newUlid(t));

    expect(new Set(ids).size).toBe(100);
    expect(ids.every((id) => decodeTime(id) === t)).toBe(true);
  });

  it.each(["I", "L", "O", "U"])("TC-UT_LIB-027 Crockford の Base32 で使わない字を含めば ULID としない（%s）", (ch) => {
    expect(isUlid(`01ARZ3NDEKTSV4RRFFQ69G5FA${ch}`)).toBe(false);
  });

  it("TC-UT_LIB-028 小文字の ULID は ULID としない（ID は大文字で採番する）", () => {
    expect(isUlid("01arz3ndektsv4rrffq69g5fav")).toBe(false);
  });
});
