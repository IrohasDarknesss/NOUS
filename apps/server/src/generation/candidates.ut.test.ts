// 単体テスト（NOUS-102）。観点表は docs/test/unit/NOUS-102/観点表_gate_candidates_rng.json
import { describe, expect, it } from "vitest";
import type { ActionKind, GenerationConfig } from "../config/generationConfig";
import { availableActions, candidateWeights, createCandidateRng, drawCandidates } from "./candidates";
import { createRng } from "./rng";

function config(overrides: Partial<GenerationConfig> = {}): GenerationConfig {
  return {
    participation: { "1": 0.3, "2": 0.45, "3": 0.6, "4": 0.75, "5": 0.9 },
    candidateCount: 2,
    weights: { post: 3, reply: 3, like: 2.5, follow: 1.5, unfollow: 0.5 },
    recentPenalty: 0.4,
    firstPersonRules: [],
    ...overrides,
  };
}

const ALL: ActionKind[] = ["post", "reply", "like", "follow", "unfollow"];

/** 決まった値を順に返す乱数 */
function fixedRng(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length]!;
}

describe("candidates（単体テスト）", () => {
  it.each([
    ["参照する投稿が 1 件", [[1], [], [], []], ["post", "reply"]],
    ["いいねできる投稿が 1 件", [[], ["p"], [], []], ["post", "like"]],
    ["フォローできる住人が 1 体", [[], [], [1], []], ["post", "follow"]],
    ["フォロー中の住人が 1 体", [[], [], [], [1]], ["post", "unfollow"]],
  ] as const)("TC-UT_CAND-006 条件がちょうど 1 件で、その種類だけが加わる（%s）", (_label, args, expected) => {
    const [refs, likeable, targets, followees] = args;

    expect(availableActions(refs, likeable, targets, followees)).toEqual(expected);
  });

  it("TC-UT_CAND-007 減点 0 なら直近の行動の種類は重み 0 になり、候補に入らない", () => {
    const c = config({ recentPenalty: 0 });

    const picks = Array.from({ length: 50 }, (_, seed) => drawCandidates(createRng(seed, "a"), ALL, ["post"], c));

    expect(candidateWeights(ALL, ["post"], c).get("post")).toBe(0);
    expect(picks.some((p) => p.includes("post"))).toBe(false);
  });

  it("TC-UT_CAND-008 減点 1 なら直近の行動があっても重みは変わらない", () => {
    const weights = candidateWeights(ALL, ["post", "post"], config({ recentPenalty: 1 }));

    expect(weights.get("post")).toBe(3);
  });

  it("TC-UT_CAND-009 直近の行動に選べない種類があっても、ほかの重みに影響しない", () => {
    const weights = candidateWeights(["post"], ["follow", "follow"], config());

    expect([...weights]).toEqual([["post", 3]]);
  });

  it("TC-UT_CAND-010 選べる種類に重複があっても、候補は重複しない", () => {
    const picked = drawCandidates(fixedRng([0, 0, 0]), ["post", "post", "reply"], [], config());

    expect(picked).toEqual(["post", "reply"]);
  });

  it("TC-UT_CAND-011 乱数が 0 なら区間の先頭の種類を選ぶ", () => {
    const picked = drawCandidates(fixedRng([0]), ALL, [], config());

    expect(picked).toEqual(["post", "reply"]);
  });

  it("TC-UT_CAND-012 乱数が 1 に近ければ区間の末尾の種類を選ぶ", () => {
    const picked = drawCandidates(fixedRng([0.9999999999]), ALL, [], config());

    expect(picked).toEqual(["unfollow", "follow"]);
  });

  it("TC-UT_CAND-013 候補の数 4 で 5 種類が選べるとき、4 つを重複なしに選ぶ", () => {
    const picks = Array.from({ length: 30 }, (_, seed) =>
      drawCandidates(createRng(seed, "a"), ALL, [], config({ candidateCount: 4 })),
    );

    expect(picks.every((p) => p.length === 4 && new Set(p).size === 4)).toBe(true);
  });

  it("TC-UT_CAND-014 すべての重みが 0 なら ['post'] を返す", () => {
    const zero = config({ weights: { post: 0, reply: 0, like: 0, follow: 0, unfollow: 0 } });

    expect(drawCandidates(fixedRng([0.5]), ALL, [], zero)).toEqual(["post"]);
  });

  it("TC-UT_CAND-015 createCandidateRng は salt「agent_id:candidates」の createRng と同じ列になる", () => {
    const a = createCandidateRng(42, "agent-x");
    const b = createRng(42, "agent-x:candidates");

    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it("TC-UT_CAND-016 乱数は選んだ候補の数だけ使う", () => {
    let calls = 0;
    const rng = () => {
      calls++;
      return 0.5;
    };

    drawCandidates(rng, ALL, [], config({ candidateCount: 3 }));

    expect(calls).toBe(3);
  });

  it("TC-UT_CAND-017 乱数が 1 を返しても（範囲の外）、区間の末尾の種類を選ぶ", () => {
    const picked = drawCandidates(fixedRng([1]), ALL, [], config());

    expect(picked).toEqual(["unfollow", "follow"]);
  });
});
