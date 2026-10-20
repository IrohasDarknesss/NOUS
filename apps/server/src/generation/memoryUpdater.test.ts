import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SEED_DATE, SEED_NOW, seedAgent, seedEvent, seedWorld } from "../../test/helpers/generationSeed";
import { createTestDb, type TestDb } from "../../test/helpers/testDb";
import { memories } from "../db/schema";
import { withTx } from "../db/tx";
import { applyAction } from "./actionApplier";
import type { ValidAction } from "./actionValidator";
import { clip, MEMORY_LIMITS, updateMemories } from "./memoryUpdater";

describe("updateMemories（8章）", () => {
  let t: TestDb;
  let worldId: string;
  let minato: string;
  let haruka: string;
  let zen: string;
  let time = 0;

  /** 行動を反映し、記憶を更新する（commitAction と同じ順） */
  const act = (agentId: string, action: ValidAction): string | null => {
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
      return "postId" in applied ? applied.postId : null;
    });
  };
  const memory = (agentId: string, kind: "recent_posts" | "relationship_summary" | "conversation_summary") =>
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

  it("TC-NOUS62_DEV-31 recent_posts に最近の行動（新しい順）と投稿の本文が入る", () => {
    const p = act(haruka, { action: "post", text: "はるかの投稿" }) as string;
    act(minato, { action: "post", text: "みなとの投稿です" });
    act(minato, { action: "like", targetRef: "P1", targetPostId: p });
    act(minato, { action: "follow", targetHandle: "haruka", targetAgentId: haruka });
    act(minato, { action: "reply", targetRef: "P1", targetPostId: p, text: "返信します" });
    expect(memory(minato, "recent_posts")).toBe(
      [
        "最近の行動：",
        "- reply @haruka：返信します",
        "- follow：@haruka",
        "- like：@haruka",
        "- post：みなとの投稿です",
        "最近の投稿：",
        "- 返信します",
        "- みなとの投稿です",
      ].join("\n"),
    );
  });

  it("TC-NOUS62_DEV-32 recent_posts は行動 5 件・本文 5 件・400 字まで", () => {
    for (let i = 0; i < 8; i++) {
      act(minato, { action: "post", text: `${i}番目の投稿。${"長".repeat(100)}` });
    }
    const content = memory(minato, "recent_posts") ?? "";
    expect([...content].length).toBeLessThanOrEqual(MEMORY_LIMITS.recent_posts);
    expect(content.split("\n").filter((l) => l.startsWith("- post：")).length).toBe(5);
    expect(content).toContain("- post：7番目の投稿。");
    expect(content).not.toContain("2番目");
  });

  it("TC-NOUS62_DEV-33 relationship_summary は相手ごとの集計を多い順に並べる", () => {
    const hp = act(haruka, { action: "post", text: "はるか" }) as string;
    const zp = act(zen, { action: "post", text: "ぜん" }) as string;
    const mp = act(minato, { action: "post", text: "みなと" }) as string;
    act(minato, { action: "follow", targetHandle: "haruka", targetAgentId: haruka });
    act(minato, { action: "reply", targetRef: "P1", targetPostId: hp, text: "返信 1" });
    act(minato, { action: "reply", targetRef: "P1", targetPostId: hp, text: "返信 2" });
    act(haruka, { action: "reply", targetRef: "P1", targetPostId: mp, text: "返信をもらう" });
    act(minato, { action: "like", targetRef: "P2", targetPostId: zp });
    expect(memory(minato, "relationship_summary")).toBe(
      ["@haruka：フォロー中、返信 2 回、返信を受けた 1 回", "@zen：いいね 1 回"].join("\n"),
    );
    // haruka の側の更新では、返信を受けた回数として数える
    expect(memory(haruka, "relationship_summary")).toBe("@minato：返信 1 回、返信を受けた 2 回");
  });

  it("TC-NOUS62_DEV-34 conversation_summary は reply のときだけ作り、起点の先頭 40 字と最後の発言者", () => {
    const root = act(haruka, { action: "post", text: `${"起".repeat(45)}` }) as string;
    act(minato, { action: "post", text: "ひとりごと" });
    expect(memory(minato, "conversation_summary")).toBeUndefined();
    const r = act(minato, { action: "reply", targetRef: "P1", targetPostId: root, text: "返信" }) as string;
    expect(memory(minato, "conversation_summary")).toBe(`「${"起".repeat(40)}」最後の発言：@minato`);
    act(haruka, { action: "reply", targetRef: "P1", targetPostId: r, text: "返信の返信" });
    act(minato, { action: "reply", targetRef: "P1", targetPostId: root, text: "もう一度" });
    expect(memory(minato, "conversation_summary")).toBe(`「${"起".repeat(40)}」最後の発言：@minato`);
    expect(memory(haruka, "conversation_summary")).toBe(`「${"起".repeat(40)}」最後の発言：@haruka`);
  });

  it("TC-NOUS62_DEV-35 none では記憶を作らない、2 回目の更新は同じ行を上書きする", () => {
    act(minato, { action: "none" });
    expect(t.db.select().from(memories).all()).toHaveLength(0);
    act(minato, { action: "post", text: "1 回目" });
    act(minato, { action: "post", text: "2 回目" });
    const rows = t.db.select().from(memories).where(eq(memories.agent_id, minato)).all();
    expect(rows.map((r) => r.kind).sort()).toEqual(["recent_posts", "relationship_summary"]);
    expect(memory(minato, "recent_posts")).toContain("2 回目");
  });

  it("TC-NOUS62_DEV-36 clip はコードポイントで切る", () => {
    expect(clip("😀😀😀", 2)).toBe("😀😀");
    expect(clip("abc", 5)).toBe("abc");
  });
});
