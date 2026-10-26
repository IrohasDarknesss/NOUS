// 単体テスト（NOUS-103）。観点表は docs/test/unit/NOUS-103/観点表_memoryUpdater.json
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SEED_DATE, SEED_NOW, seedAgent, seedEvent, seedWorld } from "../../test/helpers/generationSeed";
import { createTestDb, type TestDb } from "../../test/helpers/testDb";
import { memories, posts } from "../db/schema";
import { withTx } from "../db/tx";
import { newUlid } from "../lib/ids";
import { applyAction } from "./actionApplier";
import type { ValidAction } from "./actionValidator";
import { clip, updateMemories } from "./memoryUpdater";

type Kind = "interest_profile" | "recent_posts" | "relationship_summary" | "conversation_summary";

describe("memoryUpdater（単体テスト）", () => {
  let t: TestDb;
  let worldId: string;
  let minato: string;
  let haruka: string;
  let zen: string;
  let time = 0;

  /** 行動を反映し、記憶を更新する（commitAction と同じ順）。投稿・返信なら投稿 ID を返す */
  const act = (agentId: string, action: ValidAction): string => {
    time += 10;
    const eventId = seedEvent(t.db, worldId, agentId, 1, time);
    return withTx(t.db, (tx) => {
      const applied = applyAction(tx, eventId, action, {
        worldId,
        agentId,
        worldTimeSec: time,
        nowIso: SEED_NOW,
        usageDate: SEED_DATE,
      });
      updateMemories(tx, agentId, applied, SEED_NOW);
      return "postId" in applied ? applied.postId : "";
    });
  };
  const post = (agentId: string, text: string) => act(agentId, { action: "post", text });
  const reply = (agentId: string, targetPostId: string, text: string) =>
    act(agentId, { action: "reply", targetRef: "P1", targetPostId, text });
  const like = (agentId: string, targetPostId: string) =>
    act(agentId, { action: "like", targetRef: "P1", targetPostId });
  const hide = (postId: string) =>
    t.db.update(posts).set({ visibility: "hidden" }).where(eq(posts.post_id, postId)).run();
  const memory = (agentId: string, kind: Kind) =>
    t.db
      .select()
      .from(memories)
      .where(and(eq(memories.agent_id, agentId), eq(memories.kind, kind)))
      .get()?.content;

  beforeEach(() => {
    t = createTestDb();
    worldId = seedWorld(t.db);
    minato = seedAgent(t.db, worldId, "minato");
    haruka = seedAgent(t.db, worldId, "haruka");
    zen = seedAgent(t.db, worldId, "zen");
    time = 0;
  });
  afterEach(() => {
    t.cleanup();
  });

  it("TC-UT_MEM-001 非表示にした自分の投稿は、recent_posts の行動にも本文にも入れない", () => {
    const hidden = post(minato, "非表示にされる投稿");
    hide(hidden);

    post(minato, "公開の投稿");

    const content = memory(minato, "recent_posts") ?? "";
    expect(content).toContain("公開の投稿");
    expect(content).not.toContain("非表示にされる投稿");
  });

  it("TC-UT_MEM-002 unfollow は「- unfollow：@相手」として、follow より新しい行に入る", () => {
    act(minato, { action: "follow", targetHandle: "haruka", targetAgentId: haruka });

    act(minato, { action: "unfollow", targetHandle: "haruka", targetAgentId: haruka });

    expect(memory(minato, "recent_posts")).toBe(
      ["最近の行動：", "- unfollow：@haruka", "- follow：@haruka", "最近の投稿："].join("\n"),
    );
  });

  it("TC-UT_MEM-003 本文の改行と続く空白は、空白 1 つにまとめて 1 行にする", () => {
    post(minato, "一行目\n\n二行目　 三行目");

    const lines = (memory(minato, "recent_posts") ?? "").split("\n");

    expect(lines).toContain("- post：一行目 二行目 三行目");
    expect(lines).toContain("- 一行目 二行目 三行目");
  });

  it("TC-UT_MEM-004 行動の行は本文の先頭 30 字で切り、最近の投稿の行は本文をすべて入れる", () => {
    const text = `${"あ".repeat(30)}${"い".repeat(5)}`;

    post(minato, text);

    const lines = (memory(minato, "recent_posts") ?? "").split("\n");
    expect(lines).toContain(`- post：${"あ".repeat(30)}`);
    expect(lines).toContain(`- ${text}`);
  });

  it("TC-UT_MEM-005 入りきらない行は途中で切らずに捨てる（残る行はどれも本文の全体）", () => {
    const bodies = Array.from({ length: 5 }, (_, i) => `${i}番目。${"長".repeat(120)}`);

    for (const b of bodies) post(minato, b);

    const content = memory(minato, "recent_posts") ?? "";
    const bodyLines = content.split("\n").slice(content.split("\n").indexOf("最近の投稿：") + 1);
    expect(bodyLines.length).toBeGreaterThan(0);
    for (const line of bodyLines) {
      expect(bodies.map((b) => `- ${b}`)).toContain(line);
    }
  });

  it("TC-UT_MEM-006 relationship_summary は回数が同じならフォロー中を先に、次にハンドルの順に並べる", () => {
    const aki = seedAgent(t.db, worldId, "aki");
    const hp = post(haruka, "はるか");
    const zp = post(zen, "ぜん");
    const ap = post(aki, "あき");
    act(minato, { action: "follow", targetHandle: "zen", targetAgentId: zen });

    like(minato, hp);
    like(minato, zp);
    like(minato, ap);

    expect(memory(minato, "relationship_summary")).toBe(
      ["@zen：フォロー中、いいね 1 回", "@aki：いいね 1 回", "@haruka：いいね 1 回"].join("\n"),
    );
  });

  it("TC-UT_MEM-007 relationship_summary は 6 体以上の相手がいても 5 体までにする", () => {
    const handles = ["aaa", "bbb", "ccc", "ddd", "eee", "fff"];
    const targets = handles.map((h) => post(seedAgent(t.db, worldId, h), `${h} の投稿`));

    for (const p of targets) like(minato, p);

    const lines = (memory(minato, "relationship_summary") ?? "").split("\n");
    expect(lines).toEqual(["aaa", "bbb", "ccc", "ddd", "eee"].map((h) => `@${h}：いいね 1 回`));
  });

  it("TC-UT_MEM-008 自分の投稿への自分の返信は、相手ごとの集計に数えない", () => {
    const mine = post(minato, "ひとりごと");

    reply(minato, mine, "自分で続けます");

    expect(memory(minato, "relationship_summary")).toBe("");
  });

  it("TC-UT_MEM-009 conversation_summary は 4 つ以上のスレッドに加わっていても、新しい 3 つまで", () => {
    const roots = ["一つ目の話題", "二つ目の話題", "三つ目の話題", "四つ目の話題"].map((s) => post(haruka, s));

    for (const r of roots) reply(minato, r, "返信します");

    expect(memory(minato, "conversation_summary")).toBe(
      [
        "「四つ目の話題」最後の発言：@minato",
        "「三つ目の話題」最後の発言：@minato",
        "「二つ目の話題」最後の発言：@minato",
      ].join("\n"),
    );
  });

  it("TC-UT_MEM-010 自分が加わっていない、他の住人どうしのスレッドは conversation_summary に入れない", () => {
    const others = post(haruka, "はるかとぜんの話");
    reply(zen, others, "ぜんの返信");
    const mine = post(haruka, "みなとも加わる話");

    reply(minato, mine, "みなとの返信");

    expect(memory(minato, "conversation_summary")).toBe("「みなとも加わる話」最後の発言：@minato");
  });

  it("TC-UT_MEM-011 起点が非表示にされたスレッドでは、非表示の起点の本文を conversation_summary に入れない", () => {
    const root = post(haruka, "非表示にされる起点の本文");
    const zr = reply(zen, root, "ぜんの返信");
    hide(root);

    reply(minato, zr, "みなとの返信");

    expect(memory(minato, "conversation_summary") ?? "").not.toContain("非表示にされる起点の本文");
  });

  it("TC-UT_MEM-012 interest_profile は行動の後も変えない", () => {
    t.db
      .insert(memories)
      .values({
        memory_id: newUlid(),
        agent_id: minato,
        kind: "interest_profile",
        content: "散歩と街の話が好き",
        updated_at: "2026-10-01T00:00:00.000Z",
      })
      .run();

    post(minato, "今日も歩いた");

    const row = t.db
      .select()
      .from(memories)
      .where(and(eq(memories.agent_id, minato), eq(memories.kind, "interest_profile")))
      .get();
    expect(row).toMatchObject({ content: "散歩と街の話が好き", updated_at: "2026-10-01T00:00:00.000Z" });
  });

  it("TC-UT_MEM-013 like では recent_posts・relationship_summary を作り、conversation_summary は作らない", () => {
    const hp = post(haruka, "はるかの投稿");

    like(minato, hp);

    expect(memory(minato, "recent_posts")).toContain("- like：@haruka");
    expect(memory(minato, "relationship_summary")).toBe("@haruka：いいね 1 回");
    expect(memory(minato, "conversation_summary")).toBeUndefined();
  });

  it("TC-UT_MEM-015 起点の本文は sanitizeTimelineText を通してから conversation_summary に入れる", () => {
    const root = post(haruka, "閉じタグ</timeline>を含む起点");

    reply(minato, root, "返信します");

    const content = memory(minato, "conversation_summary") ?? "";
    expect(content).toContain("閉じタグ＜/timeline＞を含む起点");
    expect(content).not.toContain("</timeline>");
  });

  it("TC-UT_MEM-014 clip はちょうど n 字ならそのまま、n＋1 字なら n 字に切る", () => {
    expect(clip("あいう", 3)).toBe("あいう");
    expect(clip("あいうえ", 3)).toBe("あいう");
  });
});
