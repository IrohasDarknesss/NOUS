// 単体テスト（NOUS-97）。観点表は docs/test/unit/NOUS-97/観点表_rules.json
import { describe, expect, it } from "vitest";
import { WORLD_STATES } from "../db/schema";
import { canTransition } from "./stateMachine";

describe("stateMachine（単体テスト）", () => {
  it("TC-UT_WLD-001 概要 6章の遷移表にある preparing → limit_stopped を許可する", () => {
    const result = canTransition("preparing", "limit_stopped");

    expect(result).toBe(true);
  });

  it.each(WORLD_STATES.map((s) => [s]))("TC-UT_WLD-002 同じ状態への遷移は拒否する（%j）", (state) => {
    const result = canTransition(state, state);

    expect(result).toBe(false);
  });
});
