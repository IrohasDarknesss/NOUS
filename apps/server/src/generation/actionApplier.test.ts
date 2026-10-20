import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SEED_DATE, SEED_NOW, seedAgent, seedEvent, seedWorld } from "../../test/helpers/generationSeed";
import { createTestDb, type TestDb } from "../../test/helpers/testDb";
import { daily_metrics, follows, likes, posts } from "../db/schema";
import { withTx } from "../db/tx";
import { applyAction, DuplicateActionError, type ApplyContext } from "./actionApplier";
import type { ValidAction } from "./actionValidator";

describe("applyAction（7章）", () => {
  let t: TestDb;
  let worldId: string;
  let minato: string;
  let haruka: string;

  const ctx = (agentId: string, worldTimeSec = 100): ApplyContext => ({
    worldId,
    agentId,
    worldTimeSec,
    nowIso: SEED_NOW,
    usageDate: SEED_DATE,
  });
  const apply = (agentId: string, action: ValidAction, worldTimeSec = 100) => {
    const eventId = seedEvent(t.db, worldId, agentId, 1, worldTimeSec);
    return { eventId, applied: withTx(t.db, (tx) => applyAction(tx, eventId, action, ctx(agentId, worldTimeSec))) };
  };

  beforeEach(() => {
    t = createTestDb();
    worldId = seedWorld(t.db);
    minato = seedAgent(t.db, worldId, "minato");
    haruka = seedAgent(t.db, worldId, "haruka");
  });
  afterEach(() => {
    t.cleanup();
  });

  it("TC-NOUS62_DEV-21 post は reply_to=NULL・root=自分・depth=0 で 1 行入れる", () => {
    const { eventId, applied } = apply(minato, { action: "post", text: "朝の港です" });
    expect(applied.action).toBe("post");
    const row = t.db.select().from(posts).where(eq(posts.generation_event_id, eventId)).get();
    expect(row).toMatchObject({
      agent_id: minato,
      body: "朝の港です",
      reply_to_post_id: null,
      depth: 0,
      visibility: "public",
      world_time_sec: 100,
      created_at: SEED_NOW,
    });
    expect(row?.root_post_id).toBe(row?.post_id);
  });

  it("TC-NOUS62_DEV-22 reply は対象の root と depth＋1 で入れ、今日の初めての返信なら replied_posts を加算する", () => {
    const root = apply(minato, { action: "post", text: "起点" }).applied;
    const rootId = root.action === "post" ? root.postId : "";
    const r1 = apply(haruka, { action: "reply", targetRef: "P1", targetPostId: rootId, text: "返信 1" }, 110).applied;
    expect(r1).toMatchObject({
      action: "reply",
      replyToPostId: rootId,
      rootPostId: rootId,
      depth: 1,
      firstReplyToday: true,
    });
    const r1Id = r1.action === "reply" ? r1.postId : "";
    const r2 = apply(minato, { action: "reply", targetRef: "P1", targetPostId: r1Id, text: "返信 2" }, 120).applied;
    expect(r2).toMatchObject({ rootPostId: rootId, depth: 2, firstReplyToday: true });
    // 同じ投稿への 2 回目の返信は数えない
    const r3 = apply(haruka, { action: "reply", targetRef: "P1", targetPostId: rootId, text: "返信 3" }, 130).applied;
    expect(r3).toMatchObject({ firstReplyToday: false });
    const metrics = t.db.select().from(daily_metrics).get();
    expect(metrics).toMatchObject({ world_id: worldId, usage_date: SEED_DATE, replied_posts: 2 });
  });

  it("TC-NOUS62_DEV-23 前の日の投稿への返信は replied_posts に数えない", () => {
    const root = apply(minato, { action: "post", text: "昨日の投稿" }).applied;
    const rootId = root.action === "post" ? root.postId : "";
    t.db.update(posts).set({ created_at: "2026-10-21T09:00:00.000Z" }).where(eq(posts.post_id, rootId)).run();
    const r = apply(haruka, { action: "reply", targetRef: "P1", targetPostId: rootId, text: "返信" }).applied;
    expect(r).toMatchObject({ firstReplyToday: false });
    expect(t.db.select().from(daily_metrics).all()).toHaveLength(0);
  });

  it("TC-NOUS62_DEV-24 like を入れ、同じ投稿への 2 回目は DuplicateActionError", () => {
    const root = apply(minato, { action: "post", text: "起点" }).applied;
    const rootId = root.action === "post" ? root.postId : "";
    apply(haruka, { action: "like", targetRef: "P1", targetPostId: rootId });
    expect(t.db.select().from(likes).all()).toHaveLength(1);
    expect(() => apply(haruka, { action: "like", targetRef: "P1", targetPostId: rootId })).toThrow(
      DuplicateActionError,
    );
    expect(t.db.select().from(likes).all()).toHaveLength(1);
  });

  it("TC-NOUS62_DEV-25 follow → unfollow で開始と解除の時刻・イベントが残る", () => {
    const f = apply(minato, { action: "follow", targetHandle: "haruka", targetAgentId: haruka }, 100);
    const u = apply(minato, { action: "unfollow", targetHandle: "haruka", targetAgentId: haruka }, 200);
    expect(u.applied).toMatchObject({ action: "unfollow", followeeId: haruka });
    const row = t.db.select().from(follows).get();
    expect(row).toMatchObject({
      follower_id: minato,
      followee_id: haruka,
      started_world_sec: 100,
      ended_world_sec: 200,
      start_event_id: f.eventId,
      end_event_id: u.eventId,
    });
  });

  it("TC-NOUS62_DEV-26 継続中のフォローの 2 重は DuplicateActionError、フォローのない解除も DuplicateActionError", () => {
    apply(minato, { action: "follow", targetHandle: "haruka", targetAgentId: haruka });
    expect(() => apply(minato, { action: "follow", targetHandle: "haruka", targetAgentId: haruka })).toThrow(
      DuplicateActionError,
    );
    expect(() => apply(haruka, { action: "unfollow", targetHandle: "minato", targetAgentId: minato })).toThrow(
      DuplicateActionError,
    );
  });

  it("TC-NOUS62_DEV-27 同じ生成イベントでの 2 回目の投稿は DuplicateActionError（generation_event_id の UNIQUE）", () => {
    const eventId = seedEvent(t.db, worldId, minato);
    withTx(t.db, (tx) => applyAction(tx, eventId, { action: "post", text: "1 回目" }, ctx(minato)));
    try {
      withTx(t.db, (tx) => applyAction(tx, eventId, { action: "post", text: "2 回目" }, ctx(minato)));
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(DuplicateActionError);
      expect((e as DuplicateActionError).errorDetail).toMatch(/^duplicate_action .*generation_event_id/);
    }
  });

  it("TC-NOUS62_DEV-28 none は何も入れない", () => {
    expect(apply(minato, { action: "none" }).applied).toEqual({ action: "none" });
    expect(t.db.select().from(posts).all()).toHaveLength(0);
    expect(t.db.select().from(likes).all()).toHaveLength(0);
    expect(t.db.select().from(follows).all()).toHaveLength(0);
  });
});
