import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SEED_DATE, SEED_NOW, seedAgent, seedEvent, seedWorld } from "../../test/helpers/generationSeed";
import { createTestDb, type TestDb } from "../../test/helpers/testDb";
import type { GenerationConfig } from "../config/generationConfig";
import { withTx } from "../db/tx";
import { applyAction } from "./actionApplier";
import type { ValidAction } from "./actionValidator";
import { checkConsistency, splitSentences } from "./consistencyChecker";

const config: GenerationConfig = {
  participation: { "1": 0.3, "2": 0.45, "3": 0.6, "4": 0.75, "5": 0.9 },
  candidateCount: 2,
  weights: { post: 3, reply: 3, like: 2.5, follow: 1.5, unfollow: 0.5 },
  recentPenalty: 0.4,
  firstPersonRules: [
    { keywords: ["丁寧語", "敬語", "です・ます"], mismatch: ["俺", "オレ", "おれ", "あたし", "うち"] },
    { keywords: ["無口", "ぶっきらぼう", "荒っぽい"], mismatch: ["わたくし"] },
  ],
};

describe("checkConsistency（9章）", () => {
  let t: TestDb;
  let worldId: string;
  let minato: string;
  let haruka: string;

  /** 行動を反映し、同じトランザクションで検査する（commitAction と同じ順） */
  const act = (agentId: string, action: ValidAction, cycleNo = 1, personality = "穏やか") => {
    const eventId = seedEvent(t.db, worldId, agentId, cycleNo, cycleNo * 10);
    return withTx(t.db, (tx) => {
      const applied = applyAction(tx, eventId, action, {
        worldId,
        agentId,
        worldTimeSec: cycleNo * 10,
        nowIso: SEED_NOW,
        usageDate: SEED_DATE,
      });
      const flags = checkConsistency(tx, action, { worldId, agentId, eventId, cycleNo, personality }, config);
      return { applied, flags };
    });
  };
  const postId = (r: ReturnType<typeof act>): string => ("postId" in r.applied ? r.applied.postId : "");

  beforeEach(() => {
    t = createTestDb();
    worldId = seedWorld(t.db);
    minato = seedAgent(t.db, worldId, "minato");
    haruka = seedAgent(t.db, worldId, "haruka");
  });
  afterEach(() => {
    t.cleanup();
  });

  it("TC-NOUS62_DEV-41 問題のない投稿は空の配列", () => {
    expect(act(minato, { action: "post", text: "今日は晴れています。" }).flags).toEqual([]);
  });

  it("TC-NOUS62_DEV-42 C01：解除から 3 巡以内の返信は候補、4 巡後は候補にしない", () => {
    const hp = postId(act(haruka, { action: "post", text: "白い鳥を見ました。" }, 1));
    act(minato, { action: "follow", targetHandle: "haruka", targetAgentId: haruka }, 1);
    act(minato, { action: "unfollow", targetHandle: "haruka", targetAgentId: haruka }, 2);
    const within = act(minato, { action: "reply", targetRef: "P1", targetPostId: hp, text: "素敵ですね" }, 5);
    expect(within.flags.map((f) => f.code)).toEqual(["C01"]);
    expect(within.flags[0]?.detail).toContain("@haruka");
    const after = act(minato, { action: "reply", targetRef: "P1", targetPostId: hp, text: "またですね" }, 6);
    expect(after.flags).toEqual([]);
  });

  it("TC-NOUS62_DEV-43 C02：過去の自分の投稿と同じ 20 字以上の文は候補、今回の投稿自身とは比べない", () => {
    const sentence = "同じ景色でも、見る人の数だけ違う意味があると思う。";
    expect(act(minato, { action: "post", text: sentence }).flags).toEqual([]);
    const again = act(minato, { action: "post", text: `今日も歩いた。${sentence}` });
    expect(again.flags.map((f) => f.code)).toEqual(["C02"]);
    // 20 字未満の文の一致は数えない
    act(minato, { action: "post", text: "おはよう。" });
    expect(act(minato, { action: "post", text: "おはよう。" }).flags).toEqual([]);
  });

  it("TC-NOUS62_DEV-44 C02：他のエージェントの投稿との一致は数えない", () => {
    const sentence = "同じ景色でも、見る人の数だけ違う意味があると思う。";
    act(haruka, { action: "post", text: sentence });
    expect(act(minato, { action: "post", text: sentence }).flags).toEqual([]);
  });

  it("TC-NOUS62_DEV-45 C03：性格に「丁寧語」とあり本文に「俺」があれば候補、キーワードのない人格は検査しない", () => {
    const text = "俺は今日も走ったぜ。";
    const flagged = act(minato, { action: "post", text }, 1, "丁寧語で話す、几帳面");
    expect(flagged.flags.map((f) => f.code)).toEqual(["C03"]);
    expect(flagged.flags[0]?.detail).toContain("俺");
    expect(act(haruka, { action: "post", text: "俺は今日も走った。" }, 1, "明るい").flags).toEqual([]);
  });

  it("TC-NOUS62_DEV-46 C04：世界にいない @ハンドルは候補、いる住人への言及は候補にしない", () => {
    const flags = act(minato, { action: "post", text: "@haruka さんと @nobody_here さんに聞きたい。" }).flags;
    expect(flags).toEqual([{ code: "C04", detail: "世界にいない住人への言及：@nobody_here" }]);
  });

  it("TC-NOUS62_DEV-47 like・follow などの本文のない行動は C02〜C04 を見ない", () => {
    const hp = postId(act(haruka, { action: "post", text: "投稿" }));
    expect(act(minato, { action: "like", targetRef: "P1", targetPostId: hp }).flags).toEqual([]);
  });

  it("TC-NOUS62_DEV-48 splitSentences は句点と改行で分ける", () => {
    expect(splitSentences("一。二！三？\n四")).toEqual(["一。", "二！", "三？", "四"]);
  });
});
