import { decodeTime } from "ulid";
import { describe, expect, it } from "vitest";
import { isUlid, newUlid } from "./ids.js";

describe("ids", () => {
  it("TC-NOUS44_DEV-06 newUlid が 26 字の ULID を返し、毎回ちがう", () => {
    const a = newUlid();
    const b = newUlid();
    expect(isUlid(a)).toBe(true);
    expect(a).not.toBe(b);
  });

  it("TC-NOUS44_DEV-07 渡した時刻が ULID の時刻の部分に入る", () => {
    const t = Date.UTC(2026, 9, 20, 0, 0, 0);
    expect(decodeTime(newUlid(t))).toBe(t);
  });

  it("TC-NOUS44_DEV-08 isUlid が形の違う文字列を拒む", () => {
    expect(isUlid("")).toBe(false);
    expect(isUlid("01ARZ3NDEKTSV4RRFFQ69G5FA")).toBe(false);
    expect(isUlid("01ARZ3NDEKTSV4RRFFQ69G5FAI")).toBe(false);
    expect(isUlid("01ARZ3NDEKTSV4RRFFQ69G5FAV")).toBe(true);
  });
});
