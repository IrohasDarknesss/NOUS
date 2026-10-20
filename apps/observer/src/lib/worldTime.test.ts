import { describe, expect, it } from "vitest";
import { formatClockJst, formatWorldTime } from "./worldTime";

describe("formatWorldTime", () => {
  it.each([
    ["TC-NOUS49_DEV-09", 0, "第 1 日 00:00"],
    ["TC-NOUS49_DEV-10", 86399, "第 1 日 23:59"],
    ["TC-NOUS49_DEV-11", 86400 + 3600 + 61, "第 2 日 01:01"],
  ])("%s 経過 %i 秒は %s", (_id, sec, expected) => {
    expect(formatWorldTime(sec)).toBe(expected);
  });
});

describe("formatClockJst", () => {
  it("TC-NOUS49_DEV-12 UTC の時刻を JST の HH:MM にする", () => {
    expect(formatClockJst(new Date("2026-10-22T05:21:00.000Z"))).toBe("14:21");
  });
});
