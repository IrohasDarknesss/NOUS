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

describe("contextLoader", () => {
  let t: TestDb;
  let s: Seed;

  beforeEach(() => {
    t = createTestDb();
    s = new Seed(t);
    s.world(WORLD_ID);
  });

  afterEach(() => t.cleanup());

  it("TC-NOUS61_DEV-41 稼働中でないエージェントは AgentNotActiveError", () => {
    const stopped = s.agent("stopped_one", { state: "stopped" });
    expect(() => loadContext({ db: t.db, worldId: WORLD_ID, agentId: stopped }, { max_ref_posts: 12 })).toThrow(
      AgentNotActiveError,
    );
    expect(() => loadContext({ db: t.db, worldId: WORLD_ID, agentId: id("A", 999) }, { max_ref_posts: 12 })).toThrow(
      AgentNotActiveError,
    );
  });

  it("TC-NOUS61_DEV-42 記憶を固定の順に並べ、空のものは除く", () => {
    const me = s.agent("me_one");
    s.memory(me, "conversation_summary", "会話");
    s.memory(me, "interest_profile", "関心");
    s.memory(me, "relationship_summary", "  ");
    const ctx = loadContext({ db: t.db, worldId: WORLD_ID, agentId: me }, { max_ref_posts: 12 });
    expect(ctx.memories).toEqual([
      { kind: "interest_profile", content: "関心" },
      { kind: "conversation_summary", content: "会話" },
    ]);
  });

  it("TC-NOUS61_DEV-43 直近 2 回の成功した行動を新しい順に読み、none と失敗は除く", () => {
    const me = s.agent("me_one");
    s.event(me, "post");
    s.event(me, "like");
    s.event(me, "follow", { status: "failed" });
    s.event(me, "none");
    s.event(me, "reply");
    const ctx = loadContext({ db: t.db, worldId: WORLD_ID, agentId: me }, { max_ref_posts: 12 });
    expect(ctx.recentActions).toEqual(["reply", "like"]);
  });

  it("TC-NOUS61_DEV-44 参照する投稿は自分の投稿・非表示・別の世界を含まず、古い順に P1 から番号を付ける", () => {
    s.world(OTHER_WORLD_ID);
    const me = s.agent("me_one");
    const ann = s.agent("ann_one");
    const far = s.agent("far_one", { worldId: OTHER_WORLD_ID });
    s.post(me, 10);
    const a1 = s.post(ann, 30);
    const a2 = s.post(ann, 20);
    s.post(ann, 40, { visibility: "hidden" });
    s.post(far, 50, { worldId: OTHER_WORLD_ID });
    const ctx = loadContext({ db: t.db, worldId: WORLD_ID, agentId: me }, { max_ref_posts: 12 });
    expect(ctx.refs.map((r) => [r.ref, r.postId])).toEqual([
      ["P1", a2],
      ["P2", a1],
    ]);
    expect(ctx.refs[0]).toMatchObject({ handle: "ann_one", displayName: "ANN_ONE", replyToHandle: null });
  });

  it("TC-NOUS61_DEV-45 自分への未返信の返信（3）→ フォロー中の投稿（5）→ 新しい投稿（残り）の優先で選ぶ", () => {
    const me = s.agent("me_one");
    const fol = s.agent("fol_one");
    const oth = s.agent("oth_one");
    s.follow(me, fol);
    const mine = s.post(me, 1);
    // 自分への返信 4 件（古い 1 件は上限 3 で落ちる）と、自分が返信済みの 1 件
    const replies = [2, 3, 4, 5].map((sec) => s.post(oth, sec, { replyTo: mine }));
    const answered = s.post(oth, 6, { replyTo: mine });
    s.post(me, 7, { replyTo: answered });
    // フォロー中の住人の投稿 6 件（古い 1 件は上限 5 で落ちる）
    const folPosts = [10, 11, 12, 13, 14, 15].map((sec) => s.post(fol, sec));
    // 新しい投稿
    const newest = [100, 101, 102].map((sec) => s.post(oth, sec));

    const refs = selectRefPosts(t.db, WORLD_ID, me, 10);
    const ids = refs.map((r) => r.postId);
    expect(ids).toHaveLength(10);
    expect(ids).toEqual(expect.arrayContaining([...replies.slice(1), ...folPosts.slice(1)]));
    // 残り 2 件は世界全体の新しい順
    expect(ids).toEqual(expect.arrayContaining([newest[2], newest[1]]));
    expect(ids).not.toContain(newest[0]);
    // 世界内時間の古い順
    expect(refs.map((r) => r.worldTimeSec)).toEqual([...refs.map((r) => r.worldTimeSec)].sort((a, b) => a - b));
    expect(refs.map((r) => r.ref)).toEqual(refs.map((_, i) => `P${i + 1}`));
    // 返信には返信先のハンドルが付く
    expect(refs.find((r) => r.postId === replies[3])?.replyToHandle).toBe("me_one");
  });

  it("TC-NOUS61_DEV-46 max_ref_posts を超えて選ばず、重複もしない", () => {
    const me = s.agent("me_one");
    const fol = s.agent("fol_one");
    s.follow(me, fol);
    const mine = s.post(me, 1);
    s.post(fol, 2, { replyTo: mine });
    s.post(fol, 3);
    s.post(fol, 4);
    const refs = selectRefPosts(t.db, WORLD_ID, me, 2);
    expect(refs).toHaveLength(2);
    expect(new Set(refs.map((r) => r.postId)).size).toBe(2);
    expect(selectRefPosts(t.db, WORLD_ID, me, 12)).toHaveLength(3);
  });

  it("TC-NOUS61_DEV-47 いいねできる投稿は、参照する投稿のうちまだいいねしていないもの", () => {
    const me = s.agent("me_one");
    const ann = s.agent("ann_one");
    const p1 = s.post(ann, 1);
    const p2 = s.post(ann, 2);
    s.like(me, p1);
    const ctx = loadContext({ db: t.db, worldId: WORLD_ID, agentId: me }, { max_ref_posts: 12 });
    expect(ctx.likeablePostIds).toEqual([p2]);
  });

  it("TC-NOUS61_DEV-48 フォローできる住人は、同じ世界の稼働中で、自分以外の、フォローしていない住人（登録順に 8 体まで）", () => {
    s.world(OTHER_WORLD_ID);
    const me = s.agent("me_one", { createdAt: "2026-10-21T08:00:00.000Z" });
    const followed = s.agent("followed_x");
    const unfollowed = s.agent("unfollowed_x");
    s.agent("stopped_x", { state: "stopped" });
    s.agent("far_x", { worldId: OTHER_WORLD_ID });
    s.follow(me, followed);
    s.follow(me, unfollowed, true);
    const many = Array.from({ length: 9 }, (_, i) => s.agent(`many_${i}`));
    const ctx = loadContext({ db: t.db, worldId: WORLD_ID, agentId: me }, { max_ref_posts: 12 });
    const handles = ctx.followTargets.map((a) => a.handle);
    expect(handles).toHaveLength(8);
    expect(handles[0]).toBe("unfollowed_x");
    expect(handles).not.toContain("me_one");
    expect(handles).not.toContain("followed_x");
    expect(handles).not.toContain("stopped_x");
    expect(handles).not.toContain("far_x");
    expect(ctx.followTargets.map((a) => a.agentId)).toEqual([unfollowed, ...many.slice(0, 7)]);
  });

  it("TC-NOUS61_DEV-49 フォロー中の住人は、継続中のフォローの相手だけ", () => {
    const me = s.agent("me_one");
    const a = s.agent("ann_one");
    const b = s.agent("bob_one");
    s.follow(me, a);
    s.follow(me, b, true);
    const ctx = loadContext({ db: t.db, worldId: WORLD_ID, agentId: me }, { max_ref_posts: 12 });
    expect(ctx.followees).toEqual([{ agentId: a, handle: "ann_one", displayName: "ANN_ONE" }]);
  });
});
