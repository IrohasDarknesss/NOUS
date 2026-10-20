import { describe, expect, it } from "vitest";
import { computeEstimate } from "./estimate";

describe("P205 computeEstimate", () => {
  it("TC-NOUS69_DEV-16 computeEstimate は通常の入力で 1巡の回数・Neurons・1日の回数と Neurons・周期の下限を計算し overLimit=false を返す", () => {
    const result = computeEstimate({ cycleMinutes: 20, activityPercent: 100, dailyNeuronsLimit: 9500 }, 15.8, 10, 0.6);
    expect(result.runsPerCycle).toBe(6);
    expect(result.neuronsPerCycle).toBe(95);
    expect(result.cyclesPerDay).toBe(72);
    expect(result.dailyRuns).toBe(432);
    expect(result.dailyNeurons).toBe(6826);
    expect(result.cycleMinutesFloor).toBe(15);
    expect(result.overLimit).toBe(false);
  });

  it("TC-NOUS69_DEV-17 computeEstimate は 1日の見込み Neurons が日次上限を超えるとき overLimit=true を返す", () => {
    const result = computeEstimate({ cycleMinutes: 15, activityPercent: 100, dailyNeuronsLimit: 5000 }, 15.8, 10, 0.6);
    // 1巡 94.8 Neurons × 96巡 = 9101 Neurons > 5000
    expect(result.dailyNeurons).toBe(9101);
    expect(result.overLimit).toBe(true);
  });

  it("TC-NOUS69_DEV-18 computeEstimate は日次上限と 1巡の Neurons から周期の下限（ceil）を逆算する", () => {
    const result = computeEstimate({ cycleMinutes: 30, activityPercent: 50, dailyNeuronsLimit: 3000 }, 20, 10, 0.5);
    // 1巡の回数 = 10 * 0.5 * 0.5 = 2.5、1巡の Neurons = 50
    // 3000 / 50 = 60 巡/日 → 1440 / 60 = 24 分
    expect(result.neuronsPerCycle).toBe(50);
    expect(result.cycleMinutesFloor).toBe(24);
  });

  it("TC-NOUS69_DEV-19 computeEstimate は周期 0・体数 0・上限 0 でも 0 除算を起こさず有限の値を返す", () => {
    const zeroResult = computeEstimate({ cycleMinutes: 0, activityPercent: 0, dailyNeuronsLimit: 0 }, 0, 0, 0);
    expect(Number.isFinite(zeroResult.dailyRuns)).toBe(true);
    expect(Number.isFinite(zeroResult.dailyNeurons)).toBe(true);
    expect(Number.isFinite(zeroResult.cycleMinutesFloor)).toBe(true);
    expect(zeroResult.dailyRuns).toBe(0);
    expect(zeroResult.dailyNeurons).toBe(0);
    expect(zeroResult.cycleMinutesFloor).toBe(0);
    expect(zeroResult.overLimit).toBe(false);
  });
});
