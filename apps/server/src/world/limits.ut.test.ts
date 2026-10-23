// 単体テスト（NOUS-97）。観点表は docs/test/unit/NOUS-97/観点表_rules.json
import { describe, expect, it } from "vitest";
import { isWithinLimits, limitReason } from "./limits";

describe("limits（単体テスト）", () => {
  it("TC-UT_WLD-003 上限を下限の 1 にしたとき、利用量 0 は上限の中、1 は上限に達している", () => {
    const limits = { daily_neurons_limit: 1, daily_runs_limit: 1 };

    const zero = {
      within: isWithinLimits({ neurons: 0, runs: 0 }, limits),
      reason: limitReason({ neurons: 0, runs: 0 }, limits),
    };
    const neuronsOne = limitReason({ neurons: 1, runs: 0 }, limits);
    const runsOne = limitReason({ neurons: 0, runs: 1 }, limits);

    expect(zero).toEqual({ within: true, reason: null });
    expect(neuronsOne).toBe("neurons_limit");
    expect(runsOne).toBe("runs_limit");
  });

  it("TC-UT_WLD-004 上限を超えた値（Neurons 9,501・実行回数 481）も上限の外になる", () => {
    const limits = { daily_neurons_limit: 9500, daily_runs_limit: 480 };

    const neuronsOver = {
      within: isWithinLimits({ neurons: 9501, runs: 0 }, limits),
      reason: limitReason({ neurons: 9501, runs: 0 }, limits),
    };
    const runsOver = {
      within: isWithinLimits({ neurons: 0, runs: 481 }, limits),
      reason: limitReason({ neurons: 0, runs: 481 }, limits),
    };

    expect(neuronsOver).toEqual({ within: false, reason: "neurons_limit" });
    expect(runsOver).toEqual({ within: false, reason: "runs_limit" });
  });
});
