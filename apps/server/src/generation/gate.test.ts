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

describe("gate", () => {
  it("TC-NOUS61_DEV-01 活動頻度に対応する参加の確率を返す", () => {
    expect([1, 2, 3, 4, 5].map((level) => participationProbability(level, DEFAULT))).toEqual([
      0.3, 0.45, 0.6, 0.75, 0.9,
    ]);
  });

  it.each([0, 6, 2.5, Number.NaN])("TC-NOUS61_DEV-02 活動頻度が 1〜5 の整数でなければ RangeError（%s）", (level) => {
    expect(() => participationProbability(level, DEFAULT)).toThrow(RangeError);
  });

  it("TC-NOUS61_DEV-03 同じ種とエージェントなら同じ判定になる", () => {
    const agent = { agent_id: "01JB0000000000000000000001", activity_level: 3 };
    for (let seed = 0; seed < 50; seed++) {
      expect(decideParticipation(agent, seed, DEFAULT)).toBe(decideParticipation(agent, seed, DEFAULT));
    }
  });

  it("TC-NOUS61_DEV-04 判定は createRng(seed, agent_id) の最初の値 < 確率", () => {
    const agent = { agent_id: "01JB0000000000000000000002", activity_level: 4 };
    for (let seed = 0; seed < 50; seed++) {
      expect(decideParticipation(agent, seed, DEFAULT)).toBe(createRng(seed, agent.agent_id)() < 0.75);
    }
  });

  it("TC-NOUS61_DEV-05 確率 0 なら参加せず、確率 1 なら必ず参加する", () => {
    const never = config({ "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 });
    const always = config({ "1": 1, "2": 1, "3": 1, "4": 1, "5": 1 });
    for (let seed = 0; seed < 100; seed++) {
      const agent = { agent_id: `agent-${seed}`, activity_level: 1 + (seed % 5) };
      expect(decideParticipation(agent, seed, never)).toBe(false);
      expect(decideParticipation(agent, seed, always)).toBe(true);
    }
  });

  it("TC-NOUS61_DEV-06 多数の種で、参加の割合が確率に近い", () => {
    const agent = { agent_id: "01JB0000000000000000000003", activity_level: 3 };
    let joined = 0;
    for (let seed = 0; seed < 5000; seed++) {
      if (decideParticipation(agent, seed, DEFAULT)) joined++;
    }
    expect(joined / 5000).toBeGreaterThan(0.55);
    expect(joined / 5000).toBeLessThan(0.65);
  });
});
