// 単体テスト（NOUS-99）。観点表は docs/test/unit/NOUS-99/観点表_P205.json
import { describe, expect, it } from "vitest";
import { computeEstimate } from "./estimate";

describe("computeEstimate（単体テスト）", () => {
  it("TC-UT_P205-001 計算した周期の下限が 15 分を下回るときは、サーバーの estimateDaily と同じく 15 分にする", () => {
    const result = computeEstimate({ cycleMinutes: 20, activityPercent: 10, dailyNeuronsLimit: 9500 }, 15.8, 10, 0.6);

    expect(result.dailyRuns).toBe(43);
    expect(result.dailyNeurons).toBe(683);
    expect(result.cycleMinutesFloor).toBe(15);
  });

  it("TC-UT_P205-002 1巡の Neurons が 0（稼働中のエージェントが 0 体）のときは、サーバーの estimateDaily と同じく周期の下限を 15 分にする", () => {
    const result = computeEstimate({ cycleMinutes: 20, activityPercent: 100, dailyNeuronsLimit: 9500 }, 15.8, 0, 0);

    expect(result.dailyRuns).toBe(0);
    expect(result.cycleMinutesFloor).toBe(15);
  });

  it("TC-UT_P205-003 見込みの元（SettingsEstimateBasis）をまとめて渡しても、数値を別々に渡したときと同じ結果にする", () => {
    const form = { cycleMinutes: 20, activityPercent: 100, dailyNeuronsLimit: 9500 };

    const fromBasis = computeEstimate(form, { avgNeuronsPerRun: 15.8, activeAgents: 10, avgParticipation: 0.6 });

    expect(fromBasis).toEqual(computeEstimate(form, 15.8, 10, 0.6));
  });

  it("TC-UT_P205-004 入力欄の文字列はそのまま数値として計算し、周期が空なら 1日の巡を 0 として 0 除算にしない", () => {
    const fromStrings = computeEstimate(
      { cycleMinutes: "20", activityPercent: "100", dailyNeuronsLimit: "9500" },
      15.8,
      10,
      0.6,
    );
    const emptyCycle = computeEstimate(
      { cycleMinutes: "", activityPercent: "100", dailyNeuronsLimit: "9500" },
      15.8,
      10,
      0.6,
    );

    expect(fromStrings).toMatchObject({ dailyRuns: 432, dailyNeurons: 6826 });
    expect(emptyCycle).toMatchObject({ cyclesPerDay: 0, dailyRuns: 0, dailyNeurons: 0, overLimit: false });
  });

  it.each([
    [720, false],
    [719, true],
  ])(
    "TC-UT_P205-005 1日の見込みの Neurons が上限ちょうどなら超えないとし、上限を 1 下回ると超えるとする（%j）",
    (limit, overLimit) => {
      const result = computeEstimate({ cycleMinutes: 20, activityPercent: 100, dailyNeuronsLimit: limit }, 10, 1, 1);

      expect(result.dailyNeurons).toBe(720);
      expect(result.overLimit).toBe(overLimit);
    },
  );
});
