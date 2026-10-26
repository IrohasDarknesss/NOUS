// 単体テスト（NOUS-103）。観点表は docs/test/unit/NOUS-103/観点表_actionApplier.json
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SEED_DATE, SEED_NOW, seedAgent, seedEvent, seedWorld } from "../../test/helpers/generationSeed";
import { createTestDb, type TestDb } from "../../test/helpers/testDb";
import { daily_metrics, follows, likes, posts, worlds } from "../db/schema";
import { withTx } from "../db/tx";
import { newUlid } from "../lib/ids";
import { applyAction, DuplicateActionError, type ApplyContext } from "./actionApplier";
import type { ValidAction } from "./actionValidator";

/** アーカイブ済みの世界を入れる（世界は、アーカイブ済みでないものを同時に 1 つしか置けない：ux_worlds_current） */
function seedArchivedWorld(db: TestDb["db"]): string {
  const id = newUlid();
  db.insert(worlds)
    .values({ world_id: id, name: "前の世界", state: "archived", archived_at: SEED_NOW, created_at: SEED_NOW })
    .run();
  return id;
}

describe("actionApplier（単体テスト）", () => {
  let t: TestDb;
  let worldId: string;
  let minato: string;
  let haruka: string;

  const ctx = (agentId: string, worldTimeSec = 100, world = worldId): ApplyContext => ({
    worldId: world,
    agentId,
    worldTimeSec,
    nowIso: SEED_NOW,
    usageDate: SEED_DATE,
  });
  const apply = (agentId: string, action: ValidAction, worldTimeSec = 100, world = worldId) => {
    const eventId = seedEvent(t.db, world, agentId, 1, worldTimeSec);
    return {
      eventId,
      applied: withTx(t.db, (tx) => applyAction(tx, eventId, action, ctx(agentId, worldTimeSec, world))),
    };
  };
  const post = (agentId: string, text: string, world = worldId): string => {
    const { applied } = apply(agentId, { action: "post", text }, 100, world);
    return applied.action === "post" ? applied.postId : "";
  };
  const reply = (agentId: string, targetPostId: string, text = "返信します") =>
    apply(agentId, { action: "reply", targetRef: "P1", targetPostId, text }, 110).applied;
  const setCreatedAt = (postId: string, createdAt: string) =>
    t.db.update(posts).set({ created_at: createdAt }).where(eq(posts.post_id, postId)).run();

  beforeEach(() => {
    t = createTestDb();
    worldId = seedWorld(t.db);
    minato = seedAgent(t.db, worldId, "minato");
    haruka = seedAgent(t.db, worldId, "haruka");
  });
  afterEach(() => {
    t.cleanup();
  });

  it("TC-UT_APL-001 返信先の投稿がなければ、DuplicateActionError でないエラーで止め、何も入れない", () => {
    const missing = "01JBZZZZZZZZZZZZZZZZZZZZZZ";

    const run = () => reply(minato, missing);

    expect(run).toThrow(/返信先の投稿が同じ世界にありません/);
    expect(run).not.toThrow(DuplicateActionError);
    expect(t.db.select().from(posts).all()).toHaveLength(0);
  });

  it("TC-UT_APL-002 返信先が別の世界の投稿なら、DuplicateActionError でないエラーで止め、何も入れない", () => {
    const otherWorld = seedArchivedWorld(t.db);
    const stranger = seedAgent(t.db, otherWorld, "stranger");
    const otherPost = post(stranger, "別の世界の投稿", otherWorld);

    const run = () => reply(minato, otherPost);

    expect(run).toThrow(/返信先の投稿が同じ世界にありません/);
    expect(run).not.toThrow(DuplicateActionError);
    expect(t.db.select().from(posts).where(eq(posts.agent_id, minato)).all()).toHaveLength(0);
  });

  it("TC-UT_APL-003 daily_metrics に今日の行があれば、replied_posts だけを 1 増やし、他の列は変えない", () => {
    t.db
      .insert(daily_metrics)
      .values({ world_id: worldId, usage_date: SEED_DATE, runs: 7, posts: 5, replies: 3, replied_posts: 2, nones: 1 })
      .run();
    const root = post(haruka, "起点");

    reply(minato, root);

    const row = t.db.select().from(daily_metrics).all();
    expect(row).toEqual([
      {
        world_id: worldId,
        usage_date: SEED_DATE,
        runs: 7,
        posts: 5,
        replies: 3,
        replied_posts: 3,
        likes: 0,
        follows: 0,
        nones: 1,
        failures: 0,
      },
    ]);
  });

  it("TC-UT_APL-004 自分の投稿への返信も、今日の初めての返信なら replied_posts に数える", () => {
    const root = post(minato, "ひとりごと");

    const applied = reply(minato, root, "自分で続けます");

    expect(applied).toMatchObject({ action: "reply", depth: 1, firstReplyToday: true });
    expect(t.db.select().from(daily_metrics).get()?.replied_posts).toBe(1);
  });

  it("TC-UT_APL-005 返信先の作成日時がその日の 00:00:00.000 なら今日の投稿として数える", () => {
    const root = post(haruka, "日付の境目の投稿");
    setCreatedAt(root, `${SEED_DATE}T00:00:00.000Z`);

    const applied = reply(minato, root);

    expect(applied).toMatchObject({ firstReplyToday: true });
    expect(t.db.select().from(daily_metrics).get()?.replied_posts).toBe(1);
  });

  it("TC-UT_APL-006 返信先の作成日時が前の日の 23:59:59.999 なら数えない", () => {
    const root = post(haruka, "日付の境目の投稿");
    setCreatedAt(root, "2026-10-21T23:59:59.999Z");

    const applied = reply(minato, root);

    expect(applied).toMatchObject({ firstReplyToday: false });
    expect(t.db.select().from(daily_metrics).all()).toHaveLength(0);
  });

  it("TC-UT_APL-007 解除の後にフォローし直すと、新しい行として入り、継続中は 1 行だけ", () => {
    apply(minato, { action: "follow", targetHandle: "haruka", targetAgentId: haruka }, 100);
    apply(minato, { action: "unfollow", targetHandle: "haruka", targetAgentId: haruka }, 200);

    const again = apply(minato, { action: "follow", targetHandle: "haruka", targetAgentId: haruka }, 300);

    const rows = t.db.select().from(follows).where(eq(follows.follower_id, minato)).all();
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.ended_world_sec === null)).toEqual([
      expect.objectContaining({ started_world_sec: 300, start_event_id: again.eventId, end_event_id: null }),
    ]);
  });

  it("TC-UT_APL-008 解除済みのフォローしかない相手の解除は DuplicateActionError（unfollow_without_follow）", () => {
    apply(minato, { action: "follow", targetHandle: "haruka", targetAgentId: haruka }, 100);
    apply(minato, { action: "unfollow", targetHandle: "haruka", targetAgentId: haruka }, 200);

    let caught: unknown;
    try {
      apply(minato, { action: "unfollow", targetHandle: "haruka", targetAgentId: haruka }, 300);
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(DuplicateActionError);
    expect((caught as DuplicateActionError).constraint).toBe("unfollow_without_follow");
    expect((caught as DuplicateActionError).errorDetail).toBe("duplicate_action unfollow_without_follow");
    expect(t.db.select().from(follows).get()).toMatchObject({ ended_world_sec: 200 });
  });

  it("TC-UT_APL-009 UNIQUE 以外の制約の違反（自分へのフォロー）は DuplicateActionError にせず、そのまま投げ直す", () => {
    const run = () => apply(minato, { action: "follow", targetHandle: "minato", targetAgentId: minato });

    expect(run).toThrow();
    expect(run).not.toThrow(DuplicateActionError);
    expect(t.db.select().from(follows).all()).toHaveLength(0);
  });

  it("TC-UT_APL-010 いいねの 2 重の errorDetail に、違反した likes の列の名前が入る", () => {
    const root = post(minato, "起点");
    apply(haruka, { action: "like", targetRef: "P1", targetPostId: root });

    let caught: unknown;
    try {
      apply(haruka, { action: "like", targetRef: "P1", targetPostId: root });
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(DuplicateActionError);
    const detail = (caught as DuplicateActionError).errorDetail;
    expect(detail).toMatch(/^duplicate_action /);
    expect(detail).toContain("likes.agent_id");
    expect(detail).toContain("likes.post_id");
  });

  it("TC-UT_APL-011 like は世界内時間・生成イベント・作成日時を残し、戻り値の ID と行が一致する", () => {
    const root = post(minato, "起点");

    const { eventId, applied } = apply(haruka, { action: "like", targetRef: "P1", targetPostId: root }, 150);

    const row = t.db
      .select()
      .from(likes)
      .where(and(eq(likes.agent_id, haruka), eq(likes.post_id, root)))
      .get();
    expect(applied).toEqual({ action: "like", likeId: row?.like_id, postId: root });
    expect(row).toMatchObject({
      world_id: worldId,
      world_time_sec: 150,
      created_at: SEED_NOW,
      generation_event_id: eventId,
    });
  });

  it("TC-UT_APL-012 follow は開始の世界内時間と生成イベントを残し、解除の列は空のまま", () => {
    const { eventId, applied } = apply(
      minato,
      { action: "follow", targetHandle: "haruka", targetAgentId: haruka },
      160,
    );

    const row = t.db.select().from(follows).get();
    expect(applied).toEqual({ action: "follow", followId: row?.follow_id, followeeId: haruka });
    expect(row).toMatchObject({
      world_id: worldId,
      follower_id: minato,
      followee_id: haruka,
      started_world_sec: 160,
      start_event_id: eventId,
      ended_world_sec: null,
      end_event_id: null,
    });
  });
});
