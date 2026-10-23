// 単体テスト（NOUS-103）。観点表は docs/test/unit/NOUS-103/観点表_consistencyChecker.json
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SEED_DATE, SEED_NOW, seedAgent, seedEvent, seedWorld } from "../../test/helpers/generationSeed";
import { createTestDb, type TestDb } from "../../test/helpers/testDb";
import type { GenerationConfig } from "../config/generationConfig";
import { worlds } from "../db/schema";
import { withTx } from "../db/tx";
import { newUlid } from "../lib/ids";
import { applyAction } from "./actionApplier";
import type { ValidAction } from "./actionValidator";
import { checkConsistency, splitSentences } from "./consistencyChecker";

// config/generation.json と同じ表
const config: GenerationConfig = {
  participation: { "1": 0.3, "2": 0.45, "3": 0.6, "4": 0.75, "5": 0.9 },
  candidateCount: 2,
  weights: { post: 3, reply: 3, like: 2.5, follow: 1.5, unfollow: 0.5 },
  recentPenalty: 0.4,
  firstPersonRules: [
    { keywords: ["丁寧語", "敬語", "です・ます"], mismatch: ["俺", "オレ", "おれ", "あたし", "うち"] },
    { keywords: ["無口", "ぶっきらぼう", "荒っぽい"], mismatch: ["わたくし"] },
    { keywords: ["子ども", "幼い"], mismatch: ["わたくし", "小生"] },
  ],
};

/** アーカイブ済みの世界を入れる（世界は、アーカイブ済みでないものを同時に 1 つしか置けない：ux_worlds_current） */
function seedArchivedWorld(db: TestDb["db"]): string {
  const id = newUlid();
  db.insert(worlds)
    .values({ world_id: id, name: "前の世界", state: "archived", archived_at: SEED_NOW, created_at: SEED_NOW })
    .run();
  return id;
}

describe("consistencyChecker（単体テスト）", () => {
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
  const post = (agentId: string, text: string, cycleNo = 1, personality = "穏やか") =>
    act(agentId, { action: "post", text }, cycleNo, personality);
  const postId = (r: ReturnType<typeof act>): string => ("postId" in r.applied ? r.applied.postId : "");
  const reply = (agentId: string, targetPostId: string, text: string, cycleNo = 1, personality = "穏やか") =>
    act(agentId, { action: "reply", targetRef: "P1", targetPostId, text }, cycleNo, personality);
  const follow = (cycleNo: number) =>
    act(minato, { action: "follow", targetHandle: "haruka", targetAgentId: haruka }, cycleNo);
  const unfollow = (cycleNo: number) =>
    act(minato, { action: "unfollow", targetHandle: "haruka", targetAgentId: haruka }, cycleNo);
  const codes = (r: ReturnType<typeof act>) => r.flags.map((f) => f.code);

  beforeEach(() => {
    t = createTestDb();
    worldId = seedWorld(t.db);
    minato = seedAgent(t.db, worldId, "minato");
    haruka = seedAgent(t.db, worldId, "haruka");
  });
  afterEach(() => {
    t.cleanup();
  });

  it("TC-UT_CON-001 C01：解除と同じ巡（差 0）の返信は候補にする", () => {
    const hp = postId(post(haruka, "白い鳥を見ました。"));
    follow(1);
    unfollow(3);

    const r = reply(minato, hp, "素敵ですね", 3);

    expect(codes(r)).toEqual(["C01"]);
  });

  it("TC-UT_CON-002 C01：フォローしたことのない相手への返信は候補にしない", () => {
    const hp = postId(post(haruka, "白い鳥を見ました。"));

    const r = reply(minato, hp, "素敵ですね", 2);

    expect(r.flags).toEqual([]);
  });

  it("TC-UT_CON-003 C01：フォローを続けている相手への返信は候補にしない", () => {
    const hp = postId(post(haruka, "白い鳥を見ました。"));
    follow(1);

    const r = reply(minato, hp, "素敵ですね", 2);

    expect(r.flags).toEqual([]);
  });

  it("TC-UT_CON-004 C01：2 回解除していれば、新しいほうの解除の巡から数える", () => {
    const hp = postId(post(haruka, "白い鳥を見ました。"));
    follow(1);
    unfollow(1);
    follow(2);
    unfollow(5);

    const r = reply(minato, hp, "素敵ですね", 8);

    expect(codes(r)).toEqual(["C01"]);
    expect(r.flags[0]?.detail).toContain("5 巡目");
  });

  it("TC-UT_CON-005 C02：ちょうど 20 字の文が過去の自分の投稿と一致すれば候補にする", () => {
    const sentence = `${"あ".repeat(19)}。`;
    post(minato, sentence);

    const r = post(minato, `前置きです。${sentence}`);

    expect(codes(r)).toEqual(["C02"]);
    expect(r.flags[0]?.detail).toContain(sentence);
  });

  it("TC-UT_CON-006 C02：19 字の文の一致は候補にしない", () => {
    const sentence = `${"あ".repeat(18)}。`;
    post(minato, sentence);

    const r = post(minato, `前置きです。${sentence}`);

    expect(r.flags).toEqual([]);
  });

  it("TC-UT_CON-007 C02：同じ文が本文に 2 回あっても候補は 1 件", () => {
    const sentence = "同じ景色でも、見る人の数だけ違う意味がある。";
    post(minato, sentence);

    const r = post(minato, `${sentence}${sentence}`);

    expect(codes(r)).toEqual(["C02"]);
  });

  it("TC-UT_CON-008 C02：2 つの文がそれぞれ過去の投稿と一致すれば候補は 2 件", () => {
    const s1 = "同じ景色でも、見る人の数だけ違う意味がある。";
    const s2 = "海の色は季節によって少しずつ変わっていくものだ。";
    post(minato, s1);
    post(minato, s2);

    const r = post(minato, `${s1}${s2}`);

    expect(codes(r)).toEqual(["C02", "C02"]);
  });

  it("TC-UT_CON-009 C03：性格に「です・ます」とあり、本文に「あたし」があれば候補にする", () => {
    const r = post(minato, "あたしは元気です。", 1, "です・ます調で話す");

    expect(codes(r)).toEqual(["C03"]);
    expect(r.flags[0]?.detail).toContain("です・ます");
  });

  it("TC-UT_CON-010 C03：性格に「無口」とあり、本文に「わたくし」があれば候補にする", () => {
    const r = post(minato, "わたくしが参ります。", 1, "無口な職人");

    expect(codes(r)).toEqual(["C03"]);
  });

  it("TC-UT_CON-011 C03：2 つの規則のキーワードに当たれば、規則ごとに 1 件ずつ候補にする", () => {
    const r = post(minato, "俺はわたくしとは言わない。", 1, "丁寧語を使うが無口");

    expect(codes(r)).toEqual(["C03", "C03"]);
  });

  it("TC-UT_CON-012 C03：合わない一人称が本文に複数あれば、1 件にまとめて並べる", () => {
    const r = post(minato, "俺もオレも走る。", 1, "丁寧語で話す");

    expect(r.flags).toEqual([{ code: "C03", detail: "性格に「丁寧語」とあるが、本文に「俺」「オレ」がある" }]);
  });

  it("TC-UT_CON-013 C03：「そのうち」も表の「うち」に当たる（表のとおり候補にする）", () => {
    const r = post(minato, "そのうち行きます。", 1, "丁寧語で話す");

    expect(codes(r)).toEqual(["C03"]);
    expect(r.flags[0]?.detail).toContain("うち");
  });

  it("TC-UT_CON-014 C04：停止中でも同じ世界にいる住人への言及は候補にしない", () => {
    seedAgent(t.db, worldId, "sleepy", { state: "stopped" });

    const r = post(minato, "@sleepy さんは元気かな。");

    expect(r.flags).toEqual([]);
  });

  it("TC-UT_CON-015 C04：別の世界にだけいる住人への言及は候補にする", () => {
    seedAgent(t.db, seedArchivedWorld(t.db), "faraway");

    const r = post(minato, "@faraway さんに会いたい。");

    expect(r.flags).toEqual([{ code: "C04", detail: "世界にいない住人への言及：@faraway" }]);
  });

  it("TC-UT_CON-016 C04：同じハンドルは 1 回だけ、いない住人が複数なら「、」でつなぐ", () => {
    const r = post(minato, "@ghost1 と @ghost2 と @ghost1 の話。");

    expect(r.flags).toEqual([{ code: "C04", detail: "世界にいない住人への言及：@ghost1、@ghost2" }]);
  });

  it("TC-UT_CON-017 reply で C01〜C04 がそろえば、C01・C02・C03・C04 の順に返す", () => {
    const sentence = "同じ景色でも、見る人の数だけ違う意味がある。";
    post(minato, sentence, 1, "丁寧語で話す");
    const hp = postId(post(haruka, "白い鳥を見ました。"));
    follow(1);
    unfollow(2);

    const r = reply(minato, hp, `${sentence}俺は@ghost_x を知らない。`, 3, "丁寧語で話す");

    expect(codes(r)).toEqual(["C01", "C02", "C03", "C04"]);
  });

  it("TC-UT_CON-018 unfollow では C01〜C04 のどれも見ない", () => {
    follow(1);

    const r = unfollow(2);

    expect(r.flags).toEqual([]);
  });

  it("TC-UT_CON-019 splitSentences は半角の ! ? でも切り、空の行は除く", () => {
    expect(splitSentences("一!二?\n\n三")).toEqual(["一!", "二?", "三"]);
  });
});
