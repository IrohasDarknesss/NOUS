// 単体テスト（NOUS-102）。観点表は docs/test/unit/NOUS-102/観点表_gate_candidates_rng.json
import { describe, expect, it } from "vitest";
import type { GenerationConfig } from "../config/generationConfig";
import { decideParticipation, participationProbability } from "./gate";
import { createRng } from "./rng";

function config(participation: GenerationConfig["participation"]): GenerationConfig {
  return {
    participation,
    candidateCount: 2,
    weights: { post: 3, reply: 3, like: 2.5, follow: 1.5, unfollow: 0.5 },
    recentPenalty: 0.4,
    firstPersonRules: [],
  };
}

const DEFAULT = config({ "1": 0.3, "2": 0.45, "3": 0.6, "4": 0.75, "5": 0.9 });

describe("gate（単体テスト）", () => {
  it("TC-UT_GATE-001 最初の乱数の値と確率が等しければ参加せず、わずかに上回れば参加する", () => {
    const agent = { agent_id: "01JB0000000000000000000004", activity_level: 3 };
    const seed = 12345;
    const v = createRng(seed, agent.agent_id)();
    const withP = (p: number) => config({ "1": 0.3, "2": 0.45, "3": p, "4": 0.75, "5": 0.9 });

    const equal = decideParticipation(agent, seed, withP(v));
    const above = decideParticipation(agent, seed, withP(Math.min(1, v + 1e-9)));

    expect(equal).toBe(false);
    expect(above).toBe(true);
  });

  it("TC-UT_GATE-002 確率は config の値を使い、設定を変えれば判定が変わる", () => {
    const agent = { agent_id: "01JB0000000000000000000005", activity_level: 2 };
    const seed = 99;
    const v = createRng(seed, agent.agent_id)();
    const below = config({ "1": 0.3, "2": v / 2, "3": 0.6, "4": 0.75, "5": 0.9 });
    const above = config({ "1": 0.3, "2": (v + 1) / 2, "3": 0.6, "4": 0.75, "5": 0.9 });

    expect(participationProbability(2, above)).toBe((v + 1) / 2);
    expect(decideParticipation(agent, seed, below)).toBe(false);
    expect(decideParticipation(agent, seed, above)).toBe(true);
  });

  it.each([Number.POSITIVE_INFINITY, -1, 1.0000001])(
    "TC-UT_GATE-003 活動頻度が 1〜5 の整数でなければ decideParticipation も RangeError（%s）",
    (level) => {
      const agent = { agent_id: "01JB0000000000000000000006", activity_level: level };

      expect(() => decideParticipation(agent, 1, DEFAULT)).toThrow(RangeError);
    },
  );

  it("TC-UT_GATE-004 エージェントが違えば、同じ種でも別の乱数で判定する", () => {
    const seed = 2026;

    const results = new Set(
      Array.from({ length: 50 }, (_, i) =>
        decideParticipation({ agent_id: `agent-${i}`, activity_level: 3 }, seed, DEFAULT),
      ),
    );

    expect(results).toEqual(new Set([true, false]));
  });
});
