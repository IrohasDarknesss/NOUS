import type { HttpBindings } from "@hono/node-server";
import {
  VIEW_COOKIE_NAME,
  type AgentPostsResponse,
  type AgentProfileView,
  type FollowsResponse,
  type ThreadView,
  type TimelineResponse,
  type WorldView,
} from "@nous/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../test/helpers/testDb";
import { FakeClock } from "../clock/fakeClock";
import { agents, follows, generation_events, invitations, likes, posts, worlds } from "../db/schema";
import { encodeCursor } from "../lib/cursor";
import type { ErrorBody } from "../lib/errors";
import { newUlid } from "../lib/ids";
import { createLogger } from "../lib/logger";
import { randomToken, sha256Hex } from "../lib/tokens";
import { createObserverApp } from "./observerServer";

const START = "2026-10-21T09:00:00.000Z";
const DATE = "2026-10-21";
const LAN = "192.168.1.20";

/** app.request に渡す env（送信元のアドレス） */
const from = (remoteAddress = LAN) => ({ incoming: { socket: { remoteAddress } } }) as unknown as HttpBindings;

/** 番号から 26 字の ULID 風 ID を作る（辞書順を固定したいとき用） */
const ulidAt = (prefix: string, n: number): string => {
  const num = String(n).padStart(4, "0");
  return `01JB0000000000000000${prefix.slice(0, 2).toUpperCase()}${num}`;
};

describe("観察サーバー API（NOUS-56）", () => {
  let t: TestDb;
  let clock: FakeClock;
  let app: ReturnType<typeof createObserverApp>;
  let viewerCookie: string;
  let eventSeq = 1;

  beforeEach(() => {
    t = createTestDb();
    clock = new FakeClock(new Date(START));
    const logger = createLogger({ level: "debug", sinks: [] });
    app = createObserverApp({ db: t.db, clock, logger }, { staticDir: null });

    const token = randomToken();
    t.db
      .insert(invitations)
      .values({
        invitation_id: newUlid(),
        label: "テスト招待",
        token_hash: sha256Hex(token),
        issued_at: START,
      })
      .run();
    viewerCookie = `${VIEW_COOKIE_NAME}=${token}`;
    eventSeq = 1;
  });

  afterEach(() => {
    t.cleanup();
  });

  const getApi = (path: string) => app.request(path, { headers: { Cookie: viewerCookie } }, from());

  const insertWorld = (
    opts: {
      worldId?: string;
      name?: string;
      state?: "preparing" | "running" | "paused" | "limit_stopped" | "emergency_stopped" | "archived";
      worldElapsedSec?: number;
      runningSince?: string | null;
      archivedAt?: string | null;
    } = {},
  ): string => {
    const worldId = opts.worldId ?? newUlid();
    const state = opts.state ?? "running";
    const runningSince = state === "running" ? (opts.runningSince ?? START) : null;
    const archivedAt = state === "archived" ? (opts.archivedAt ?? START) : null;
    t.db
      .insert(worlds)
      .values({
        world_id: worldId,
        name: opts.name ?? "テストの世界",
        state,
        world_elapsed_sec: opts.worldElapsedSec ?? 1000,
        running_since: runningSince,
        archived_at: archivedAt,
        created_at: START,
      })
      .run();
    return worldId;
  };

  const insertAgent = (
    worldId: string,
    opts: {
      agentId?: string;
      handle: string;
      displayName?: string;
      bio?: string;
      state?: "active" | "stopped";
      activityLevel?: number;
    },
  ): string => {
    const agentId = opts.agentId ?? newUlid();
    t.db
      .insert(agents)
      .values({
        agent_id: agentId,
        world_id: worldId,
        handle: opts.handle,
        display_name: opts.displayName ?? opts.handle,
        bio: opts.bio ?? `${opts.handle}の自己紹介`,
        interests: "読書",
        topics: "日常",
        personality: "穏やか",
        values_text: "誠実",
        stance: "中立",
        activity_level: opts.activityLevel ?? 4,
        state: opts.state ?? "active",
        created_at: START,
        updated_at: START,
      })
      .run();
    return agentId;
  };

  const insertEvent = (worldId: string, agentId: string, worldTimeSec = 1000): string => {
    const eventId = newUlid();
    t.db
      .insert(generation_events)
      .values({
        event_id: eventId,
        world_id: worldId,
        agent_id: agentId,
        cycle_no: eventSeq++,
        cycle_seed: 42,
        status: "succeeded",
        decided_by: "llm",
        action: "post",
        model_id: "@cf/google/gemma-4-26b-a4b-it",
        prompt_version: "v1",
        llm_mode: "fixed",
        world_time_sec: worldTimeSec,
        started_at: START,
        finished_at: START,
        usage_date: DATE,
      })
      .run();
    return eventId;
  };

  const insertPost = (
    worldId: string,
    agentId: string,
    opts: {
      postId?: string;
      body?: string;
      worldTimeSec?: number;
      replyToPostId?: string | null;
      rootPostId?: string;
      depth?: number;
      visibility?: "public" | "hidden";
    } = {},
  ): string => {
    const postId = opts.postId ?? newUlid();
    const replyToPostId = opts.replyToPostId ?? null;
    const rootPostId = replyToPostId === null ? postId : (opts.rootPostId ?? replyToPostId);
    const depth = replyToPostId === null ? 0 : (opts.depth ?? 1);
    const worldTimeSec = opts.worldTimeSec ?? 1000;
    const eventId = insertEvent(worldId, agentId, worldTimeSec);

    t.db
      .insert(posts)
      .values({
        post_id: postId,
        world_id: worldId,
        agent_id: agentId,
        body: opts.body ?? `投稿 ${postId}`,
        reply_to_post_id: replyToPostId,
        root_post_id: rootPostId,
        depth,
        visibility: opts.visibility ?? "public",
        world_time_sec: worldTimeSec,
        created_at: START,
        generation_event_id: eventId,
      })
      .run();
    return postId;
  };

  const insertLike = (worldId: string, agentId: string, postId: string, worldTimeSec = 1000): string => {
    const likeId = newUlid();
    const eventId = insertEvent(worldId, agentId, worldTimeSec);
    t.db
      .insert(likes)
      .values({
        like_id: likeId,
        world_id: worldId,
        agent_id: agentId,
        post_id: postId,
        world_time_sec: worldTimeSec,
        created_at: START,
        generation_event_id: eventId,
      })
      .run();
    return likeId;
  };

  const insertFollow = (
    worldId: string,
    followerId: string,
    followeeId: string,
    opts: { startedWorldSec?: number; endedWorldSec?: number | null } = {},
  ): string => {
    const followId = newUlid();
    const startedWorldSec = opts.startedWorldSec ?? 1000;
    const endedWorldSec = opts.endedWorldSec ?? null;
    const startEventId = insertEvent(worldId, followerId, startedWorldSec);
    const endEventId = endedWorldSec !== null ? insertEvent(worldId, followerId, endedWorldSec) : null;
    t.db
      .insert(follows)
      .values({
        follow_id: followId,
        world_id: worldId,
        follower_id: followerId,
        followee_id: followeeId,
        started_world_sec: startedWorldSec,
        ended_world_sec: endedWorldSec,
        start_event_id: startEventId,
        end_event_id: endEventId,
      })
      .run();
    return followId;
  };

  describe("GET /api/world", () => {
    it("TC-NOUS56_DEV-03 running の世界で state・worldTimeSec・isRunning: true・updatedAt と Cache-Control: no-store を返す", async () => {
      insertWorld({ state: "running", worldElapsedSec: 7200, runningSince: START });
      await clock.advance(60_000);

      const res = await getApi("/api/world");
      expect(res.status).toBe(200);
      expect(res.headers.get("Cache-Control")).toBe("no-store");
      const body = (await res.json()) as WorldView;
      expect(body).toEqual({
        state: "running",
        worldTimeSec: 7260,
        isRunning: true,
        updatedAt: clock.nowIso(),
      });
    });

    it("TC-NOUS56_DEV-04 paused の世界では isRunning: false と確定済みの worldTimeSec を返す", async () => {
      insertWorld({ state: "paused", worldElapsedSec: 3600 });
      await clock.advance(120_000);

      const res = await getApi("/api/world");
      expect(res.status).toBe(200);
      const body = (await res.json()) as WorldView;
      expect(body).toEqual({
        state: "paused",
        worldTimeSec: 3600,
        isRunning: false,
        updatedAt: clock.nowIso(),
      });
    });

    it("TC-NOUS56_DEV-05 現在の世界が存在しない場合は 404 WORLD_NOT_FOUND を返す", async () => {
      insertWorld({ state: "archived", archivedAt: START });

      const res = await getApi("/api/world");
      expect(res.status).toBe(404);
      const body = (await res.json()) as ErrorBody;
      expect(body.error.code).toBe("WORLD_NOT_FOUND");
    });
  });

  describe("GET /api/timeline", () => {
    it("TC-NOUS56_DEV-06 public の投稿だけを (world_time_sec, post_id) の降順で返し、hidden や別世界の投稿は含めない", async () => {
      const archivedWorldId = insertWorld({ state: "archived", name: "旧世界" });
      const oldAgentId = insertAgent(archivedWorldId, { handle: "old_agent" });
      insertPost(archivedWorldId, oldAgentId, { body: "旧世界の投稿", worldTimeSec: 9999 });

      const worldId = insertWorld({ state: "running", worldElapsedSec: 5000 });
      const agentId = insertAgent(worldId, { handle: "minato", displayName: "ミナト" });

      const p1 = insertPost(worldId, agentId, {
        postId: ulidAt("PT", 1),
        body: "1番目",
        worldTimeSec: 1000,
      });
      const p2 = insertPost(worldId, agentId, {
        postId: ulidAt("PT", 2),
        body: "2番目（同秒・ID大）",
        worldTimeSec: 2000,
      });
      const p3 = insertPost(worldId, agentId, {
        postId: ulidAt("PT", 1),
        replyToPostId: p1,
        rootPostId: p1,
        depth: 1,
        body: "hiddenの投稿",
        worldTimeSec: 3000,
        visibility: "hidden",
      });
      void p3;
      const p4 = insertPost(worldId, agentId, {
        postId: ulidAt("PT", 10),
        body: "2番目（同秒・IDさらに大）",
        worldTimeSec: 2000,
      });

      const res = await getApi("/api/timeline");
      expect(res.status).toBe(200);
      expect(res.headers.get("Cache-Control")).toBe("no-store");
      const data = (await res.json()) as TimelineResponse;
      expect(data.world).toEqual({ state: "running", worldTimeSec: 5000 });
      expect(data.items.map((i) => i.postId)).toEqual([p4, p2, p1]);
      expect(data.items.every((i) => i.agent.isAi === true)).toBe(true);
      expect(data.nextCursor).toBeNull();
    });

    it("TC-NOUS56_DEV-07 limit と nextCursor で続きを重複・欠落なくページ送りできる", async () => {
      const worldId = insertWorld({ state: "paused", worldElapsedSec: 4000 });
      const agentId = insertAgent(worldId, { handle: "haruka", displayName: "ハルカ" });

      const p1 = insertPost(worldId, agentId, { postId: ulidAt("PG", 1), worldTimeSec: 100 });
      const p2 = insertPost(worldId, agentId, { postId: ulidAt("PG", 2), worldTimeSec: 200 });
      const p3 = insertPost(worldId, agentId, { postId: ulidAt("PG", 3), worldTimeSec: 200 });
      const p4 = insertPost(worldId, agentId, { postId: ulidAt("PG", 4), worldTimeSec: 300 });
      const p5 = insertPost(worldId, agentId, { postId: ulidAt("PG", 5), worldTimeSec: 400 });

      const res1 = await getApi("/api/timeline?limit=2");
      const page1 = (await res1.json()) as TimelineResponse;
      expect(page1.items.map((i) => i.postId)).toEqual([p5, p4]);
      expect(page1.nextCursor).not.toBeNull();

      const res2 = await getApi(`/api/timeline?limit=2&cursor=${encodeURIComponent(page1.nextCursor!)}`);
      const page2 = (await res2.json()) as TimelineResponse;
      expect(page2.items.map((i) => i.postId)).toEqual([p3, p2]);
      expect(page2.nextCursor).not.toBeNull();

      const res3 = await getApi(`/api/timeline?limit=2&cursor=${encodeURIComponent(page2.nextCursor!)}`);
      const page3 = (await res3.json()) as TimelineResponse;
      expect(page3.items.map((i) => i.postId)).toEqual([p1]);
      expect(page3.nextCursor).toBeNull();
    });

    it("TC-NOUS56_DEV-08 replyCount（publicのみ）・likeCount・replyTo（hiddenの親でも返す）を付与する", async () => {
      const worldId = insertWorld({ state: "running", worldElapsedSec: 2000 });
      const a1 = insertAgent(worldId, { handle: "minato", displayName: "ミナト" });
      const a2 = insertAgent(worldId, { handle: "haruka", displayName: "ハルカ" });

      const rootPublic = insertPost(worldId, a1, {
        postId: ulidAt("RP", 1),
        body: "公開の親投稿",
        worldTimeSec: 100,
      });
      const rootHidden = insertPost(worldId, a2, {
        postId: ulidAt("RP", 2),
        body: "非表示の親投稿",
        worldTimeSec: 200,
        visibility: "hidden",
      });

      // rootPublic への public 返信 2 件、hidden 返信 1 件
      const reply1 = insertPost(worldId, a2, {
        postId: ulidAt("RP", 3),
        body: "返信1",
        replyToPostId: rootPublic,
        rootPostId: rootPublic,
        depth: 1,
        worldTimeSec: 300,
      });
      insertPost(worldId, a1, {
        postId: ulidAt("RP", 4),
        body: "返信2",
        replyToPostId: rootPublic,
        rootPostId: rootPublic,
        depth: 1,
        worldTimeSec: 400,
      });
      insertPost(worldId, a2, {
        postId: ulidAt("RP", 5),
        body: "非表示の返信",
        replyToPostId: rootPublic,
        rootPostId: rootPublic,
        depth: 1,
        worldTimeSec: 500,
        visibility: "hidden",
      });

      // rootHidden への public 返信
      const replyToHidden = insertPost(worldId, a1, {
        postId: ulidAt("RP", 6),
        body: "非表示の親への返信",
        replyToPostId: rootHidden,
        rootPostId: rootHidden,
        depth: 1,
        worldTimeSec: 600,
      });

      insertLike(worldId, a1, rootPublic, 700);
      insertLike(worldId, a2, rootPublic, 710);
      insertLike(worldId, a1, reply1, 720);

      const res = await getApi("/api/timeline");
      expect(res.status).toBe(200);
      const { items } = (await res.json()) as TimelineResponse;

      const rootView = items.find((i) => i.postId === rootPublic);
      expect(rootView).toMatchObject({
        postId: rootPublic,
        replyTo: null,
        replyCount: 2,
        likeCount: 2,
      });

      const reply1View = items.find((i) => i.postId === reply1);
      expect(reply1View).toMatchObject({
        postId: reply1,
        replyTo: { postId: rootPublic, handle: "minato", displayName: "ミナト" },
        replyCount: 0,
        likeCount: 1,
      });

      const replyHiddenTargetView = items.find((i) => i.postId === replyToHidden);
      expect(replyHiddenTargetView).toMatchObject({
        postId: replyToHidden,
        replyTo: { postId: rootHidden, handle: "haruka", displayName: "ハルカ" },
        replyCount: 0,
        likeCount: 0,
      });
    });

    it("TC-NOUS56_DEV-09 since 指定時はその投稿より新しい public 投稿を最大 50 件返し、nextCursor は null、cursor と両方あれば since を優先する", async () => {
      const worldId = insertWorld({ state: "running", worldElapsedSec: 9000 });
      const agentId = insertAgent(worldId, { handle: "minato", displayName: "ミナト" });

      const basePost = insertPost(worldId, agentId, {
        postId: ulidAt("SN", 1),
        worldTimeSec: 100,
      });
      // 全部で 55 件の新しい投稿を入れる（TIMELINE_SINCE_MAX = 50）
      const newerIds: string[] = [];
      for (let i = 2; i <= 56; i++) {
        newerIds.push(
          insertPost(worldId, agentId, {
            postId: ulidAt("SN", i),
            worldTimeSec: 100 + i,
          }),
        );
      }

      // cursor も同時に渡して since が優先されることを確かめる
      const dummyCursor = encodeCursor(["150", ulidAt("SN", 10)]);
      const res = await getApi(`/api/timeline?since=${basePost}&cursor=${dummyCursor}`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as TimelineResponse;
      expect(body.nextCursor).toBeNull();
      expect(body.items).toHaveLength(50);
      expect(body.items[0]?.postId).toBe(newerIds[newerIds.length - 1]);
      expect(body.items.some((i) => i.postId === basePost)).toBe(false);

      // 現在の世界にない投稿 ID を since に渡したときは items が空
      const resMissing = await getApi(`/api/timeline?since=${ulidAt("ZZ", 99)}`);
      expect(resMissing.status).toBe(200);
      const missingBody = (await resMissing.json()) as TimelineResponse;
      expect(missingBody.items).toEqual([]);
      expect(missingBody.nextCursor).toBeNull();
    });

    it("TC-NOUS56_DEV-10 不正な cursor・limit・since で 400 VALIDATION_ERROR を返す", async () => {
      insertWorld();

      const badCases: Array<{ query: string; field: string }> = [
        { query: "limit=0", field: "limit" },
        { query: "limit=51", field: "limit" },
        { query: "limit=abc", field: "limit" },
        { query: "since=short", field: "since" },
        { query: `cursor=${encodeCursor(["only_one"])}`, field: "cursor" },
        { query: `cursor=${encodeCursor(["-1", ulidAt("BD", 1)])}`, field: "cursor" },
        { query: `cursor=${encodeCursor(["not_int", ulidAt("BD", 1)])}`, field: "cursor" },
        { query: `cursor=${encodeCursor(["100", "short_id"])}`, field: "cursor" },
      ];

      for (const { query, field } of badCases) {
        const res = await getApi(`/api/timeline?${query}`);
        expect(res.status, query).toBe(400);
        const err = (await res.json()) as ErrorBody;
        expect(err.error.code, query).toBe("VALIDATION_ERROR");
        expect(err.error.fields[field], query).toBeTruthy();
      }
    });
  });

  describe("GET /api/posts/:postId/thread", () => {
    it("TC-NOUS56_DEV-11 スレッドの木を組み立て、hidden の節は body と agent を null（hidden: true）にして子を残す", async () => {
      const worldId = insertWorld({ state: "running", worldElapsedSec: 3000 });
      const a1 = insertAgent(worldId, { handle: "minato", displayName: "ミナト" });
      const a2 = insertAgent(worldId, { handle: "haruka", displayName: "ハルカ" });

      const rootId = insertPost(worldId, a1, {
        postId: ulidAt("TH", 1),
        body: "ルート投稿",
        worldTimeSec: 100,
      });
      const hiddenChildId = insertPost(worldId, a2, {
        postId: ulidAt("TH", 2),
        body: "伏せられる返信",
        replyToPostId: rootId,
        rootPostId: rootId,
        depth: 1,
        worldTimeSec: 200,
        visibility: "hidden",
      });
      const grandChildId = insertPost(worldId, a1, {
        postId: ulidAt("TH", 3),
        body: "hiddenの子の返信（残る）",
        replyToPostId: hiddenChildId,
        rootPostId: rootId,
        depth: 2,
        worldTimeSec: 300,
      });

      insertLike(worldId, a2, rootId, 400);
      insertLike(worldId, a2, grandChildId, 410);

      // hidden の投稿を postId に指定しても 200 で開ける
      const res = await getApi(`/api/posts/${hiddenChildId}/thread`);
      expect(res.status).toBe(200);
      expect(res.headers.get("Cache-Control")).toBe("no-store");
      const view = (await res.json()) as ThreadView;

      expect(view.focusPostId).toBe(hiddenChildId);
      expect(view.root.postId).toBe(rootId);
      expect(view.root.hidden).toBe(false);
      expect(view.root.body).toBe("ルート投稿");
      expect(view.root.agent?.isAi).toBe(true);
      expect(view.root.likeCount).toBe(1);
      expect(view.root.moreCount).toBe(0);

      expect(view.root.children).toHaveLength(1);
      const hiddenNode = view.root.children[0]!;
      expect(hiddenNode.postId).toBe(hiddenChildId);
      expect(hiddenNode.hidden).toBe(true);
      expect(hiddenNode.body).toBeNull();
      expect(hiddenNode.agent).toBeNull();
      expect(hiddenNode.moreCount).toBe(0);

      expect(hiddenNode.children).toHaveLength(1);
      const grandChildNode = hiddenNode.children[0]!;
      expect(grandChildNode.postId).toBe(grandChildId);
      expect(grandChildNode.hidden).toBe(false);
      expect(grandChildNode.body).toBe("hiddenの子の返信（残る）");
      expect(grandChildNode.agent?.isAi).toBe(true);
      expect(grandChildNode.likeCount).toBe(1);
    });

    it("TC-NOUS56_DEV-12 depth の上限で children を空にして moreCount に子孫総数を入れ、from 指定で部分木を返す", async () => {
      const worldId = insertWorld({ state: "running", worldElapsedSec: 3000 });
      const a1 = insertAgent(worldId, { handle: "minato", displayName: "ミナト" });

      // root(0) -> c1(1) -> c2(2) -> c3a(3), c3b(3)
      const rootId = insertPost(worldId, a1, { postId: ulidAt("DP", 1), worldTimeSec: 100 });
      const c1 = insertPost(worldId, a1, {
        postId: ulidAt("DP", 2),
        replyToPostId: rootId,
        rootPostId: rootId,
        depth: 1,
        worldTimeSec: 200,
      });
      const c2 = insertPost(worldId, a1, {
        postId: ulidAt("DP", 3),
        replyToPostId: c1,
        rootPostId: rootId,
        depth: 2,
        worldTimeSec: 300,
      });
      const c3a = insertPost(worldId, a1, {
        postId: ulidAt("DP", 4),
        replyToPostId: c2,
        rootPostId: rootId,
        depth: 3,
        worldTimeSec: 400,
      });
      const c3b = insertPost(worldId, a1, {
        postId: ulidAt("DP", 5),
        replyToPostId: c2,
        rootPostId: rootId,
        depth: 3,
        worldTimeSec: 500,
      });

      // depth=1 なら root(0) -> c1(1, children=[], moreCount=3)
      const resDepth1 = await getApi(`/api/posts/${rootId}/thread?depth=1`);
      expect(resDepth1.status).toBe(200);
      const view1 = (await resDepth1.json()) as ThreadView;
      expect(view1.root.moreCount).toBe(0);
      expect(view1.root.children).toHaveLength(1);
      expect(view1.root.children[0]?.postId).toBe(c1);
      expect(view1.root.children[0]?.children).toEqual([]);
      expect(view1.root.children[0]?.moreCount).toBe(3);

      // from=c2&depth=1 なら c2 が起点になり、c3a・c3b が段数 1 として返る
      const resFrom = await getApi(`/api/posts/${rootId}/thread?from=${c2}&depth=1`);
      expect(resFrom.status).toBe(200);
      const viewFrom = (await resFrom.json()) as ThreadView;
      expect(viewFrom.focusPostId).toBe(rootId);
      expect(viewFrom.root.postId).toBe(c2);
      expect(viewFrom.root.children.map((n) => n.postId)).toEqual([c3a, c3b]);
      expect(viewFrom.root.children.every((n) => n.moreCount === 0)).toBe(true);
    });

    it("TC-NOUS56_DEV-13 存在しない postId・別スレッドの from は 404 POST_NOT_FOUND、不正な depth・from は 400 VALIDATION_ERROR", async () => {
      const worldId = insertWorld();
      const agentId = insertAgent(worldId, { handle: "minato" });
      const threadA = insertPost(worldId, agentId, { postId: ulidAt("TA", 1), worldTimeSec: 100 });
      const threadB = insertPost(worldId, agentId, { postId: ulidAt("TB", 1), worldTimeSec: 200 });

      const notFound1 = await getApi(`/api/posts/${ulidAt("NO", 1)}/thread`);
      expect(notFound1.status).toBe(404);
      expect(((await notFound1.json()) as ErrorBody).error.code).toBe("POST_NOT_FOUND");

      // 別スレッドの投稿を from に指定したら 404 POST_NOT_FOUND
      const notFoundFrom = await getApi(`/api/posts/${threadA}/thread?from=${threadB}`);
      expect(notFoundFrom.status).toBe(404);
      expect(((await notFoundFrom.json()) as ErrorBody).error.code).toBe("POST_NOT_FOUND");

      const badDepth = await getApi(`/api/posts/${threadA}/thread?depth=11`);
      expect(badDepth.status).toBe(400);
      expect(((await badDepth.json()) as ErrorBody).error.code).toBe("VALIDATION_ERROR");

      const badFrom = await getApi(`/api/posts/${threadA}/thread?from=bad`);
      expect(badFrom.status).toBe(400);
      expect(((await badFrom.json()) as ErrorBody).error.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("GET /api/agents/:agentId", () => {
    it("TC-NOUS56_DEV-14 プロフィールと件数（継続中フォロー・public投稿のみ）を返し、activity_level は含めず、停止中も返す", async () => {
      const worldId = insertWorld();
      const targetId = insertAgent(worldId, {
        agentId: ulidAt("AG", 1),
        handle: "minato",
        displayName: "ミナト",
        bio: "海が好き",
        state: "stopped",
        activityLevel: 5,
      });
      const other1 = insertAgent(worldId, { agentId: ulidAt("AG", 2), handle: "haruka" });
      const other2 = insertAgent(worldId, { agentId: ulidAt("AG", 3), handle: "sora" });

      // フォロー中: 継続 1、解除済み 1
      insertFollow(worldId, targetId, other1, { startedWorldSec: 100 });
      insertFollow(worldId, targetId, other2, { startedWorldSec: 100, endedWorldSec: 200 });

      // フォロワー: 継続 2
      insertFollow(worldId, other1, targetId, { startedWorldSec: 150 });
      insertFollow(worldId, other2, targetId, { startedWorldSec: 160 });

      // 投稿: public 2、hidden 1
      insertPost(worldId, targetId, { worldTimeSec: 300, visibility: "public" });
      insertPost(worldId, targetId, { worldTimeSec: 400, visibility: "public" });
      insertPost(worldId, targetId, { worldTimeSec: 500, visibility: "hidden" });

      const res = await getApi(`/api/agents/${targetId}`);
      expect(res.status).toBe(200);
      expect(res.headers.get("Cache-Control")).toBe("no-store");
      const profile = (await res.json()) as AgentProfileView & Record<string, unknown>;

      expect(profile).toEqual({
        agentId: targetId,
        handle: "minato",
        displayName: "ミナト",
        bio: "海が好き",
        interests: "読書",
        topics: "日常",
        personality: "穏やか",
        valuesText: "誠実",
        stance: "中立",
        isAi: true,
        state: "stopped",
        followingCount: 1,
        followerCount: 2,
        postCount: 2,
      });
      expect("activity_level" in profile).toBe(false);
      expect("activityLevel" in profile).toBe(false);
    });

    it("TC-NOUS56_DEV-15 現在の世界にいないエージェントは 404 AGENT_NOT_FOUND を返す", async () => {
      const archivedWorldId = insertWorld({ state: "archived", name: "旧世界" });
      const oldAgentId = insertAgent(archivedWorldId, { handle: "old_minato" });
      insertWorld({ state: "running" });

      const res1 = await getApi(`/api/agents/${oldAgentId}`);
      expect(res1.status).toBe(404);
      expect(((await res1.json()) as ErrorBody).error.code).toBe("AGENT_NOT_FOUND");

      const res2 = await getApi(`/api/agents/${ulidAt("NO", 99)}`);
      expect(res2.status).toBe(404);
      expect(((await res2.json()) as ErrorBody).error.code).toBe("AGENT_NOT_FOUND");
    });
  });

  describe("GET /api/agents/:agentId/posts", () => {
    it("TC-NOUS56_DEV-16 指定エージェントの public 投稿（返信含む）だけをカーソルでページ送りでき、不在なら 404", async () => {
      const worldId = insertWorld();
      const a1 = insertAgent(worldId, { handle: "minato", displayName: "ミナト" });
      const a2 = insertAgent(worldId, { handle: "haruka", displayName: "ハルカ" });

      const otherPost = insertPost(worldId, a2, { postId: ulidAt("AP", 1), worldTimeSec: 100 });
      const myPost1 = insertPost(worldId, a1, { postId: ulidAt("AP", 2), worldTimeSec: 200 });
      insertPost(worldId, a1, {
        postId: ulidAt("AP", 3),
        worldTimeSec: 250,
        visibility: "hidden",
      });
      const myReply = insertPost(worldId, a1, {
        postId: ulidAt("AP", 4),
        replyToPostId: otherPost,
        rootPostId: otherPost,
        depth: 1,
        worldTimeSec: 300,
      });

      const res1 = await getApi(`/api/agents/${a1}/posts?limit=1`);
      expect(res1.status).toBe(200);
      expect(res1.headers.get("Cache-Control")).toBe("no-store");
      const page1 = (await res1.json()) as AgentPostsResponse;
      expect(page1.items).toHaveLength(1);
      expect(page1.items[0]?.postId).toBe(myReply);
      expect(page1.items[0]?.agent.isAi).toBe(true);
      expect(page1.items[0]?.replyTo).toEqual({
        postId: otherPost,
        handle: "haruka",
        displayName: "ハルカ",
      });
      expect(page1.nextCursor).not.toBeNull();

      const res2 = await getApi(`/api/agents/${a1}/posts?limit=1&cursor=${encodeURIComponent(page1.nextCursor!)}`);
      const page2 = (await res2.json()) as AgentPostsResponse;
      expect(page2.items.map((i) => i.postId)).toEqual([myPost1]);
      expect(page2.nextCursor).toBeNull();

      const res404 = await getApi(`/api/agents/${ulidAt("NO", 50)}/posts`);
      expect(res404.status).toBe(404);
      expect(((await res404.json()) as ErrorBody).error.code).toBe("AGENT_NOT_FOUND");
    });
  });

  describe("GET /api/agents/:agentId/follows", () => {
    it("TC-NOUS56_DEV-17 following と followers を started_world_sec 降順で返し、解除済み（ended_world_sec あり）は含めない", async () => {
      const worldId = insertWorld();
      const me = insertAgent(worldId, { handle: "minato", displayName: "ミナト" });
      const u1 = insertAgent(worldId, { handle: "haruka", displayName: "ハルカ" });
      const u2 = insertAgent(worldId, { handle: "sora", displayName: "ソラ", state: "stopped" });
      const u3 = insertAgent(worldId, { handle: "riku", displayName: "リク" });

      // following: u1(100), u2(300), u3(200・解除済み)
      insertFollow(worldId, me, u1, { startedWorldSec: 100 });
      insertFollow(worldId, me, u2, { startedWorldSec: 300 });
      insertFollow(worldId, me, u3, { startedWorldSec: 200, endedWorldSec: 250 });

      // followers: u3(400), u1(150), u2(120・解除済み)
      insertFollow(worldId, u3, me, { startedWorldSec: 400 });
      insertFollow(worldId, u1, me, { startedWorldSec: 150 });
      insertFollow(worldId, u2, me, { startedWorldSec: 120, endedWorldSec: 180 });

      const resFollowing = await getApi(`/api/agents/${me}/follows?type=following`);
      expect(resFollowing.status).toBe(200);
      expect(resFollowing.headers.get("Cache-Control")).toBe("no-store");
      const following = (await resFollowing.json()) as FollowsResponse;
      expect(following.items).toEqual([
        {
          agentId: u2,
          handle: "sora",
          displayName: "ソラ",
          isAi: true,
          state: "stopped",
          startedWorldSec: 300,
        },
        {
          agentId: u1,
          handle: "haruka",
          displayName: "ハルカ",
          isAi: true,
          state: "active",
          startedWorldSec: 100,
        },
      ]);

      const resFollowers = await getApi(`/api/agents/${me}/follows?type=followers`);
      expect(resFollowers.status).toBe(200);
      const followers = (await resFollowers.json()) as FollowsResponse;
      expect(followers.items).toEqual([
        {
          agentId: u3,
          handle: "riku",
          displayName: "リク",
          isAi: true,
          state: "active",
          startedWorldSec: 400,
        },
        {
          agentId: u1,
          handle: "haruka",
          displayName: "ハルカ",
          isAi: true,
          state: "active",
          startedWorldSec: 150,
        },
      ]);
    });

    it("TC-NOUS56_DEV-18 不正な type で 400 VALIDATION_ERROR、存在しないエージェントで 404 AGENT_NOT_FOUND を返す", async () => {
      const worldId = insertWorld();
      const me = insertAgent(worldId, { handle: "minato" });

      const res400 = await getApi(`/api/agents/${me}/follows?type=invalid`);
      expect(res400.status).toBe(400);
      const err400 = (await res400.json()) as ErrorBody;
      expect(err400.error.code).toBe("VALIDATION_ERROR");
      expect(err400.error.fields.type).toBeTruthy();

      const resMissingType = await getApi(`/api/agents/${me}/follows`);
      expect(resMissingType.status).toBe(400);

      const res404 = await getApi(`/api/agents/${ulidAt("NO", 77)}/follows?type=following`);
      expect(res404.status).toBe(404);
      expect(((await res404.json()) as ErrorBody).error.code).toBe("AGENT_NOT_FOUND");
    });
  });
});
