// 単体テスト（NOUS-106）。観点表は docs/test/unit/NOUS-106/観点表_api_lib.json
import { describe, expect, it } from "vitest";
import { formatClockJst, formatWorldTime } from "./worldTime";

describe("worldTime（単体テスト）", () => {
  it.each([
    { sec: -1, expected: "第 1 日 00:00" },
    { sec: 59.9, expected: "第 1 日 00:00" },
  ])("TC-UT_OWEB-013 formatWorldTime は負の値を 0 に、小数を切り捨てて扱う（$sec）", ({ sec, expected }) => {
    const text = formatWorldTime(sec);

    expect(text).toBe(expected);
  });

  it.each([
    { sec: 59, expected: "第 1 日 00:00" },
    { sec: 60, expected: "第 1 日 00:01" },
    { sec: 3599, expected: "第 1 日 00:59" },
    { sec: 3600, expected: "第 1 日 01:00" },
    { sec: 86400, expected: "第 2 日 00:00" },
  ])("TC-UT_OWEB-014 formatWorldTime は分・時・日の境目で繰り上がる（$sec）", ({ sec, expected }) => {
    const text = formatWorldTime(sec);

    expect(text).toBe(expected);
  });

  it.each([
    { at: "2026-10-22T14:59:00.000Z", expected: "23:59" },
    { at: "2026-10-22T15:00:00.000Z", expected: "00:00" },
  ])("TC-UT_OWEB-015 formatClockJst は JST の日付の境目で 23:59 と 00:00 を出す（$at）", ({ at, expected }) => {
    const text = formatClockJst(new Date(at));

    expect(text).toBe(expected);
  });
});
