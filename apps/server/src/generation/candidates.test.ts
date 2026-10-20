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

describe("availableActions", () => {
  it("TC-NOUS61_DEV-11 何もなければ post だけ", () => {
    expect(availableActions([], [], [], [])).toEqual(["post"]);
  });

  it("TC-NOUS61_DEV-12 条件ごとに reply・like・follow・unfollow が加わる", () => {
    expect(availableActions([{}], [], [], [])).toEqual(["post", "reply"]);
    expect(availableActions([{}], ["p1"], [], [])).toEqual(["post", "reply", "like"]);
    expect(availableActions([], [], [{}], [])).toEqual(["post", "follow"]);
    expect(availableActions([], [], [], [{}])).toEqual(["post", "unfollow"]);
    expect(availableActions([{}], ["p1"], [{}], [{}])).toEqual(ALL);
  });
});

describe("drawCandidates", () => {
  it("TC-NOUS61_DEV-13 既定では候補を 2 つ、重複なしに選ぶ", () => {
    for (let seed = 0; seed < 200; seed++) {
      const picked = drawCandidates(createRng(seed, "a"), ALL, [], config());
      expect(picked).toHaveLength(2);
      expect(new Set(picked).size).toBe(2);
      for (const kind of picked) expect(ALL).toContain(kind);
    }
  });

  it("TC-NOUS61_DEV-14 候補の数は config.candidateCount に従う（2〜4）", () => {
    for (const count of [2, 3, 4]) {
      expect(drawCandidates(createRng(1, "a"), ALL, [], config({ candidateCount: count }))).toHaveLength(count);
    }
  });

  it("TC-NOUS61_DEV-15 選べる種類が候補の数より少なければ、その数だけ返す", () => {
    expect(drawCandidates(createRng(1, "a"), ["post"], [], config())).toEqual(["post"]);
    expect(new Set(drawCandidates(createRng(1, "a"), ["post", "like"], [], config({ candidateCount: 4 })))).toEqual(
      new Set(["post", "like"]),
    );
  });

  it("TC-NOUS61_DEV-16 選べる種類が無ければ ['post']", () => {
    expect(drawCandidates(createRng(1, "a"), [], [], config())).toEqual(["post"]);
  });

  it("TC-NOUS61_DEV-17 選べない種類は候補に入らない", () => {
    for (let seed = 0; seed < 100; seed++) {
      const picked = drawCandidates(createRng(seed, "a"), ["post", "reply", "like"], [], config());
      expect(picked.every((k) => k === "post" || k === "reply" || k === "like")).toBe(true);
    }
  });

  it("TC-NOUS61_DEV-18 直近の行動に含まれるたびに重みを recentPenalty 倍にする", () => {
    const weights = candidateWeights(ALL, ["post", "post"], config());
    expect(weights.get("post")).toBeCloseTo(3 * 0.4 * 0.4);
    expect(weights.get("reply")).toBe(3);
    expect(candidateWeights(ALL, ["like", "reply"], config()).get("like")).toBeCloseTo(2.5 * 0.4);
  });

  it("TC-NOUS61_DEV-19 重みに比例して選ぶ（累積の区間で決まる）", () => {
    // 重み post 3・reply 3・like 2.5・follow 1.5・unfollow 0.5（合計 10.5）。0.0 → post、0.99 → unfollow
    expect(drawCandidates(fixedRng([0, 0]), ALL, [], config())[0]).toBe("post");
    expect(drawCandidates(fixedRng([0.99, 0]), ALL, [], config())[0]).toBe("unfollow");
    // 3/10.5 ≒ 0.2857 の少し上は reply
    expect(drawCandidates(fixedRng([0.29, 0]), ALL, [], config())[0]).toBe("reply");
  });

  it("TC-NOUS61_DEV-20 重み 0 の種類は選ばない", () => {
    const zeroFollow = config({ weights: { post: 1, reply: 1, like: 1, follow: 0, unfollow: 0 }, candidateCount: 4 });
    for (let seed = 0; seed < 100; seed++) {
      const picked = drawCandidates(createRng(seed, "a"), ALL, [], zeroFollow);
      expect(picked).not.toContain("follow");
      expect(picked).not.toContain("unfollow");
    }
  });

  it("TC-NOUS61_DEV-21 減点された種類は選ばれにくくなる", () => {
    const count = (recent: ActionKind[]): number => {
      let n = 0;
      for (let seed = 0; seed < 3000; seed++) {
        if (drawCandidates(createRng(seed, "a"), ALL, recent, config()).includes("post")) n++;
      }
      return n;
    };
    expect(count(["post", "post"])).toBeLessThan(count([]));
  });

  it("TC-NOUS61_DEV-22 同じ種なら同じ候補になり、判定の乱数とは別の列を使う", () => {
    const a = drawCandidates(createCandidateRng(42, "agent"), ALL, [], config());
    const b = drawCandidates(createCandidateRng(42, "agent"), ALL, [], config());
    expect(a).toEqual(b);
    expect(createCandidateRng(42, "agent")()).not.toBe(createRng(42, "agent")());
  });
});
