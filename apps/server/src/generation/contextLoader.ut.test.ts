// 単体テスト（NOUS-102）。観点表は docs/test/unit/NOUS-102/観点表_contextLoader.json
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../test/helpers/testDb";
import { agents, follows, generation_events, likes, memories, posts, worlds } from "../db/schema";
import { AgentNotActiveError, loadContext, selectRefPosts } from "./contextLoader";

const NOW = "2026-10-21T09:00:00.000Z";
const WORLD_ID = "01JB0000000000000000000001";
const OTHER_WORLD_ID = "01JB0000000000000000000009";

const id = (prefix: string, n: number): string => `${prefix}${String(n).padStart(26 - prefix.length, "0")}`;

type ActionName = "post" | "reply" | "like" | "follow" | "unfollow" | "none";

/** 世界・エージェント・生成イベント・投稿などを入れる小さな補助 */
class Seed {
  private n = 0;
  constructor(private readonly t: TestDb) {}

  world(worldId: string): void {
    this.t.db.insert(worlds).values({ world_id: worldId, name: "w", created_at: NOW }).run();
  }

  agent(handle: string, opts: { worldId?: string; state?: "active" | "stopped"; createdAt?: string } = {}): string {
    const agentId = id("A", ++this.n);
    this.t.db
      .insert(agents)
      .values({
        agent_id: agentId,
        world_id: opts.worldId ?? WORLD_ID,
        handle,
        display_name: handle.toUpperCase(),
        interests: "海",
        topics: "天気",
        personality: "丁寧語",
        values_text: "正確さ",
        stance: "訂正を入れる",
        activity_level: 3,
        state: opts.state ?? "active",
        created_at: opts.createdAt ?? NOW,
        updated_at: NOW,
      })
      .run();
    return agentId;
  }

  event(
    agentId: string,
    action: ActionName = "post",
    opts: { status?: "succeeded" | "failed"; worldId?: string } = {},
  ): string {
    const eventId = id("E", ++this.n);
    this.t.db
      .insert(generation_events)
      .values({
        event_id: eventId,
        world_id: opts.worldId ?? WORLD_ID,
        agent_id: agentId,
        cycle_no: 1,
        cycle_seed: 1,
        status: opts.status ?? "succeeded",
        decided_by: "llm",
        action,
        failure_kind: opts.status === "failed" ? "invalid_format" : null,
        model_id: "@cf/google/gemma-4-26b-a4b-it",
        prompt_version: "v1",
        llm_mode: "fixed",
        world_time_sec: this.n,
        started_at: new Date(Date.parse(NOW) + this.n * 1000).toISOString(),
        finished_at: NOW,
        usage_date: "2026-10-21",
      })
      .run();
    return eventId;
  }

  post(
    agentId: string,
    worldTimeSec: number,
    opts: { replyTo?: string; visibility?: "public" | "hidden"; body?: string; worldId?: string } = {},
  ): string {
    const postId = id("P", ++this.n);
    const parent = opts.replyTo
      ? this.t.db
          .select()
          .from(posts)
          .all()
          .find((p) => p.post_id === opts.replyTo)
      : undefined;
    this.t.db
      .insert(posts)
      .values({
        post_id: postId,
        world_id: opts.worldId ?? WORLD_ID,
        agent_id: agentId,
        body: opts.body ?? `body ${postId}`,
        reply_to_post_id: parent?.post_id ?? null,
        root_post_id: parent?.root_post_id ?? postId,
        depth: parent ? parent.depth + 1 : 0,
        visibility: opts.visibility ?? "public",
        world_time_sec: worldTimeSec,
        created_at: NOW,
        generation_event_id: this.event(agentId, parent ? "reply" : "post", { worldId: opts.worldId }),
      })
      .run();
    return postId;
  }

  follow(follower: string, followee: string, ended = false): void {
    this.t.db
      .insert(follows)
      .values({
        follow_id: id("F", ++this.n),
        world_id: WORLD_ID,
        follower_id: follower,
        followee_id: followee,
        started_world_sec: 0,
        ended_world_sec: ended ? 1 : null,
        start_event_id: this.event(follower, "follow"),
        end_event_id: ended ? this.event(follower, "unfollow") : null,
      })
      .run();
  }

  like(agentId: string, postId: string): void {
    this.t.db
      .insert(likes)
      .values({
        like_id: id("L", ++this.n),
        world_id: WORLD_ID,
        agent_id: agentId,
        post_id: postId,
        world_time_sec: 0,
        created_at: NOW,
        generation_event_id: this.event(agentId, "like"),
      })
      .run();
  }

  memory(
    agentId: string,
    kind: "interest_profile" | "recent_posts" | "relationship_summary" | "conversation_summary",
    content: string,
  ): void {
    this.t.db
      .insert(memories)
      .values({ memory_id: id("M", ++this.n), agent_id: agentId, kind, content, updated_at: NOW })
      .run();
  }
}

describe("contextLoader（単体テスト）", () => {
  let t: TestDb;
  let s: Seed;

  beforeEach(() => {
    t = createTestDb();
    s = new Seed(t);
    s.world(WORLD_ID);
  });

  afterEach(() => t.cleanup());

  it("TC-UT_CTX-001 別の世界のエージェントとして読むと AgentNotActiveError", () => {
    s.world(OTHER_WORLD_ID);
    const far = s.agent("far_one", { worldId: OTHER_WORLD_ID });

    expect(() => loadContext({ db: t.db, worldId: WORLD_ID, agentId: far }, { max_ref_posts: 12 })).toThrow(
      AgentNotActiveError,
    );
  });

  it("TC-UT_CTX-002 直近の行動は、同じ世界の生成イベントだけを読む", () => {
    s.world(OTHER_WORLD_ID);
    const me = s.agent("me_one");
    s.event(me, "like");
    s.event(me, "follow", { worldId: OTHER_WORLD_ID });

    const ctx = loadContext({ db: t.db, worldId: WORLD_ID, agentId: me }, { max_ref_posts: 12 });

    expect(ctx.recentActions).toEqual(["like"]);
  });

  it("TC-UT_CTX-003 自分の投稿への返信は、古くても世界全体の新しい投稿より先に選び、他人の投稿への返信は優先しない", () => {
    const me = s.agent("me_one");
    const ann = s.agent("ann_one");
    const bob = s.agent("bob_one");
    const mine = s.post(me, 1);
    const toMe = s.post(ann, 2, { replyTo: mine });
    const annPost = s.post(ann, 3);
    s.post(bob, 4, { replyTo: annPost });
    s.post(bob, 5);

    const refs = selectRefPosts(t.db, WORLD_ID, me, 1);

    expect(refs.map((r) => r.postId)).toEqual([toMe]);
  });

  it("TC-UT_CTX-004 非表示の返信は、自分の投稿への返信でも選ばない", () => {
    const me = s.agent("me_one");
    const ann = s.agent("ann_one");
    const mine = s.post(me, 1);
    s.post(ann, 2, { replyTo: mine, visibility: "hidden" });

    expect(selectRefPosts(t.db, WORLD_ID, me, 12)).toEqual([]);
  });

  it("TC-UT_CTX-005 フォロー中の住人の投稿は、古くても世界全体の新しい投稿より先に選び、解除したフォローは優先しない", () => {
    const me = s.agent("me_one");
    const fol = s.agent("fol_one");
    const old = s.agent("old_one");
    const oth = s.agent("oth_one");
    s.follow(me, fol);
    s.follow(me, old, true);
    const folPost = s.post(fol, 1);
    s.post(old, 2);
    const newest = s.post(oth, 3);

    const one = selectRefPosts(t.db, WORLD_ID, me, 1);
    const two = selectRefPosts(t.db, WORLD_ID, me, 2);

    expect(one.map((r) => r.postId)).toEqual([folPost]);
    expect(two.map((r) => r.postId)).toEqual([folPost, newest]);
  });

  it("TC-UT_CTX-006 max_ref_posts が 1 のとき、自分への返信が 3 件あっても新しい 1 件だけを P1 にする", () => {
    const me = s.agent("me_one");
    const ann = s.agent("ann_one");
    const mine = s.post(me, 1);
    const replies = [2, 3, 4].map((sec) => s.post(ann, sec, { replyTo: mine }));

    const refs = selectRefPosts(t.db, WORLD_ID, me, 1);

    expect(refs.map((r) => [r.ref, r.postId])).toEqual([["P1", replies[2]]]);
  });

  it("TC-UT_CTX-007 世界内時間が同じ投稿は、投稿 ID の順に並べる", () => {
    const me = s.agent("me_one");
    const ann = s.agent("ann_one");
    const a = s.post(ann, 5);
    const b = s.post(ann, 5);

    const refs = selectRefPosts(t.db, WORLD_ID, me, 12);

    expect(refs.map((r) => r.postId)).toEqual([a, b].sort());
  });

  it("TC-UT_CTX-008 投稿も住人も記憶もなければ、参照する投稿・いいねできる投稿・相手の一覧・記憶は空", () => {
    const me = s.agent("me_one");

    const ctx = loadContext({ db: t.db, worldId: WORLD_ID, agentId: me }, { max_ref_posts: 12 });

    expect(ctx).toMatchObject({ refs: [], likeablePostIds: [], followTargets: [], followees: [], memories: [] });
  });

  it("TC-UT_CTX-009 停止中の住人の公開中の投稿は参照する投稿に入り、停止中の住人へのフォローはフォロー中に残る", () => {
    const me = s.agent("me_one");
    const st = s.agent("st_one");
    const p = s.post(st, 1);
    s.follow(me, st);
    t.db.update(agents).set({ state: "stopped" }).where(eq(agents.agent_id, st)).run();

    const ctx = loadContext({ db: t.db, worldId: WORLD_ID, agentId: me }, { max_ref_posts: 12 });

    expect(ctx.refs.map((r) => r.postId)).toEqual([p]);
    expect(ctx.followees.map((a) => a.agentId)).toEqual([st]);
    expect(ctx.followTargets).toEqual([]);
  });

  it("TC-UT_CTX-010 自分の投稿への返信に自分が返信済みでも、その返信は世界全体の新しい投稿として選べる", () => {
    const me = s.agent("me_one");
    const ann = s.agent("ann_one");
    const mine = s.post(me, 1);
    const answered = s.post(ann, 2, { replyTo: mine });
    s.post(me, 3, { replyTo: answered });

    const refs = selectRefPosts(t.db, WORLD_ID, me, 12);

    expect(refs.map((r) => r.postId)).toEqual([answered]);
  });
});
