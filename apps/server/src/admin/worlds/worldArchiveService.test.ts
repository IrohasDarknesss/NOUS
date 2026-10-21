import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TEST_NOW, seedAdmin } from "../../../test/helpers/adminTestSupport";
import { createTestDb, type TestDb } from "../../../test/helpers/testDb";
import { FakeClock } from "../../clock/fakeClock";
import { agents, generation_events, posts, worlds } from "../../db/schema";
import { encodeCursor } from "../../lib/cursor";
import { newUlid } from "../../lib/ids";
import { searchPosts } from "../moderation/postQueryService";
import { getArchiveGenerations, getArchivePosts, listWorldSummaries } from "./worldArchiveService";

describe("worldArchiveService", () => {
  let t: TestDb;
  let clock: FakeClock;

  beforeEach(() => {
    t = createTestDb();
    clock = new FakeClock(TEST_NOW);
    seedAdmin(t.db, TEST_NOW);
  });

  afterEach(() => {
    t.cleanup();
  });

  function seedWorld(
    worldId: string,
    name: string,
    state: "preparing" | "running" | "paused" | "limit_stopped" | "emergency_stopped" | "archived",
    createdAt: string,
    worldElapsedSec = 100,
    runningSince: string | null = null,
  ): void {
    t.db
      .insert(worlds)
      .values({
        world_id: worldId,
        name,
        state,
        world_elapsed_sec: worldElapsedSec,
        running_since: runningSince,
        created_at: createdAt,
        started_at: createdAt,
        archived_at: state === "archived" ? createdAt : null,
      })
      .run();
  }

  function seedAgent(worldId: string, handle = "minato", displayName = "ミナト"): string {
    const agentId = newUlid(clock.nowMs());
    const iso = clock.nowIso();
    t.db
      .insert(agents)
      .values({
        agent_id: agentId,
        world_id: worldId,
        handle,
        display_name: displayName,
        interests: "テスト",
        topics: "トピック",
        personality: "性格",
        values_text: "価値観",
        stance: "スタンス",
        created_at: iso,
        updated_at: iso,
      })
      .run();
    return agentId;
  }

  function seedPost(
    worldId: string,
    agentId: string,
    options: {
      postId?: string;
      body?: string;
      visibility?: "public" | "hidden";
      worldTimeSec?: number;
      replyToPostId?: string | null;
    } = {},
  ): string {
    const postId = options.postId ?? newUlid(clock.nowMs());
    const eventId = newUlid(clock.nowMs());
    const iso = clock.nowIso();

    t.db
      .insert(generation_events)
      .values({
        event_id: eventId,
        world_id: worldId,
        agent_id: agentId,
        cycle_no: 1,
        cycle_seed: 1,
        decided_by: "llm",
        model_id: "@cf/google/gemma-4-26b-a4b-it",
        prompt_version: "v1",
        llm_mode: "cloudflare",
        world_time_sec: options.worldTimeSec ?? 10,
        started_at: iso,
        usage_date: "2026-10-20",
      })
      .run();

    t.db
      .insert(posts)
      .values({
        post_id: postId,
        world_id: worldId,
        agent_id: agentId,
        body: options.body ?? "テスト本文",
        root_post_id: options.replyToPostId ?? postId,
        reply_to_post_id: options.replyToPostId ?? null,
        depth: options.replyToPostId ? 1 : 0,
        visibility: options.visibility ?? "public",
        world_time_sec: options.worldTimeSec ?? 10,
        created_at: iso,
        generation_event_id: eventId,
      })
      .run();

    return postId;
  }

  it("TC-NOUS65_DEV-17 listWorldSummaries は全世界を created_at の新しい順に返し、各カウントと worldTimeSec を計算する", () => {
    const w1 = newUlid(clock.nowMs());
    const w2 = newUlid(clock.nowMs());

    // w1: archived（確定値 500秒）
    seedWorld(w1, "旧世界", "archived", "2026-10-18T00:00:00.000Z", 500, null);

    // w2: running（経過秒 + running_since からの経過）
    seedWorld(w2, "現世界", "running", "2026-10-19T00:00:00.000Z", 200, "2026-10-20T00:00:00.000Z");

    const a1 = seedAgent(w1, "agent1");
    seedAgent(w1, "agent2");
    seedPost(w1, a1);

    const a2 = seedAgent(w2, "agent3");
    seedPost(w2, a2);
    seedPost(w2, a2);

    const res = listWorldSummaries(t.db, clock);
    expect(res.items).toHaveLength(2);

    // created_at 降順（w2 -> w1）
    expect(res.items[0]?.worldId).toBe(w2);
    expect(res.items[0]?.name).toBe("現世界");
    expect(res.items[0]?.agentCount).toBe(1);
    expect(res.items[0]?.postCount).toBe(2);
    expect(res.items[0]?.worldTimeSec).toBe(200);

    expect(res.items[1]?.worldId).toBe(w1);
    expect(res.items[1]?.name).toBe("旧世界");
    expect(res.items[1]?.agentCount).toBe(2);
    expect(res.items[1]?.postCount).toBe(1);
    expect(res.items[1]?.worldTimeSec).toBe(500);
  });

  it("TC-NOUS65_DEV-18 listWorldPosts は非表示の投稿を含めて (world_time_sec, post_id) の降順に返し、ページ送りできる", () => {
    const worldId = newUlid(clock.nowMs());
    seedWorld(worldId, "アーカイブ世界", "archived", "2026-10-18T00:00:00.000Z");
    const agentId = seedAgent(worldId);

    const p1 = seedPost(worldId, agentId, { body: "公開投稿", visibility: "public", worldTimeSec: 100 });
    const p2 = seedPost(worldId, agentId, { body: "非表示投稿", visibility: "hidden", worldTimeSec: 200 });

    const page1 = getArchivePosts(t.db, worldId, { limit: 1 });
    expect(page1.items).toHaveLength(1);
    expect(page1.items[0]?.postId).toBe(p2);
    expect(page1.items[0]?.visibility).toBe("hidden");
    expect(page1.nextCursor).not.toBeNull();

    const page2 = getArchivePosts(t.db, worldId, { limit: 1, cursor: page1.nextCursor! });
    expect(page2.items).toHaveLength(1);
    expect(page2.items[0]?.postId).toBe(p1);
    expect(page2.items[0]?.visibility).toBe("public");
    expect(page2.nextCursor).toBeNull();
  });

  it("TC-NOUS65_DEV-19 listWorldPosts は不正なカーソルに 400 VALIDATION_ERROR を投げる", () => {
    const worldId = newUlid(clock.nowMs());
    seedWorld(worldId, "世界", "archived", "2026-10-18T00:00:00.000Z");

    expect(() => getArchivePosts(t.db, worldId, { cursor: "invalid-cursor" })).toThrowError(
      expect.objectContaining({ code: "VALIDATION_ERROR" }),
    );
  });

  it("TC-NOUS65_DEV-20 getArchivePosts は存在する世界の投稿を返し、存在しない世界には 404 WORLD_NOT_FOUND を投げる", () => {
    const worldId = newUlid(clock.nowMs());
    seedWorld(worldId, "世界", "archived", "2026-10-18T00:00:00.000Z");
    const agentId = seedAgent(worldId);
    seedPost(worldId, agentId);

    const res = getArchivePosts(t.db, worldId, {});
    expect(res.items).toHaveLength(1);

    expect(() => getArchivePosts(t.db, newUlid(clock.nowMs()), {})).toThrowError(
      expect.objectContaining({ code: "WORLD_NOT_FOUND" }),
    );
  });

  it("TC-NOUS65_DEV-21 getArchiveGenerations は指定した世界の生成ログのみを返し、存在しない世界には 404 WORLD_NOT_FOUND を投げる", () => {
    const w1 = newUlid(clock.nowMs());
    const w2 = newUlid(clock.nowMs());
    seedWorld(w1, "世界1", "archived", "2026-10-18T00:00:00.000Z");
    seedWorld(w2, "世界2", "archived", "2026-10-19T00:00:00.000Z");

    const a1 = seedAgent(w1, "a1");
    const a2 = seedAgent(w2, "a2");

    const iso = clock.nowIso();
    t.db
      .insert(generation_events)
      .values([
        {
          event_id: newUlid(clock.nowMs()),
          world_id: w1,
          agent_id: a1,
          cycle_no: 1,
          cycle_seed: 1,
          decided_by: "llm",
          model_id: "@cf/google/gemma-4-26b-a4b-it",
          prompt_version: "v1",
          llm_mode: "cloudflare",
          world_time_sec: 10,
          started_at: iso,
          usage_date: "2026-10-20",
        },
        {
          event_id: newUlid(clock.nowMs()),
          world_id: w2,
          agent_id: a2,
          cycle_no: 1,
          cycle_seed: 2,
          decided_by: "llm",
          model_id: "@cf/google/gemma-4-26b-a4b-it",
          prompt_version: "v1",
          llm_mode: "cloudflare",
          world_time_sec: 20,
          started_at: iso,
          usage_date: "2026-10-20",
        },
      ])
      .run();

    const res1 = getArchiveGenerations(t.db, w1, {});
    expect(res1.items).toHaveLength(1);
    expect(res1.items[0]?.agent.displayName).toBe("ミナト");

    expect(() => getArchiveGenerations(t.db, newUlid(clock.nowMs()), {})).toThrowError(
      expect.objectContaining({ code: "WORLD_NOT_FOUND" }),
    );
  });

  it("TC-NOUS85_DEV-01 getArchivePosts は同じ条件の searchPosts と同じ応答（items の各項目と nextCursor）を返す", () => {
    const worldId = newUlid(clock.nowMs());
    seedWorld(worldId, "アーカイブ世界", "archived", "2026-10-18T00:00:00.000Z");
    const a1 = seedAgent(worldId, "agent1", "エージェント1");
    const a2 = seedAgent(worldId, "agent2", "エージェント2");

    const p1 = seedPost(worldId, a1, { body: "投稿1", visibility: "public", worldTimeSec: 100 });
    const p2 = seedPost(worldId, a2, {
      body: "投稿2（返信・非表示）",
      visibility: "hidden",
      worldTimeSec: 200,
      replyToPostId: p1,
    });
    const p3 = seedPost(worldId, a1, { body: "投稿3", visibility: "public", worldTimeSec: 300 });

    const archivePage1 = getArchivePosts(t.db, worldId, { limit: 2 });
    const searchPage1 = searchPosts(t.db, worldId, { limit: 2 });

    expect(archivePage1).toEqual(searchPage1);
    expect(archivePage1.items).toHaveLength(2);
    expect(archivePage1.nextCursor).not.toBeNull();

    // 項目が漏れなく揃っていることを確認
    const first = archivePage1.items[0]!;
    expect(first.postId).toBe(p3);
    expect(first.body).toBe("投稿3");
    expect(first.visibility).toBe("public");
    expect(first.worldTimeSec).toBe(300);
    expect(typeof first.createdAt).toBe("string");
    expect(first.agent).toEqual({ agentId: a1, displayName: "エージェント1" });
    expect(first.replyToPostId).toBeNull();
    expect(typeof first.generationEventId).toBe("string");

    const second = archivePage1.items[1]!;
    expect(second.postId).toBe(p2);
    expect(second.visibility).toBe("hidden");
    expect(second.replyToPostId).toBe(p1);

    // 2 ページ目も等しい
    const archivePage2 = getArchivePosts(t.db, worldId, { limit: 2, cursor: archivePage1.nextCursor! });
    const searchPage2 = searchPosts(t.db, worldId, { limit: 2, cursor: searchPage1.nextCursor! });
    expect(archivePage2).toEqual(searchPage2);
    expect(archivePage2.items).toHaveLength(1);
    expect(archivePage2.items[0]?.postId).toBe(p1);
    expect(archivePage2.nextCursor).toBeNull();
  });

  it("TC-NOUS85_DEV-02 getArchivePosts は同じ world_time_sec の投稿を含めてページ送りしても、重複・欠落なく新しい順に全件が並ぶ", () => {
    const worldId = newUlid(clock.nowMs());
    seedWorld(worldId, "アーカイブ世界", "archived", "2026-10-18T00:00:00.000Z");
    const agentId = seedAgent(worldId);

    // 同じ worldTimeSec を含む投稿をシード
    const p1 = seedPost(worldId, agentId, { body: "p1", worldTimeSec: 10 });
    const p2 = seedPost(worldId, agentId, { body: "p2", worldTimeSec: 20 });
    const p3 = seedPost(worldId, agentId, { body: "p3", worldTimeSec: 20 });
    const p4 = seedPost(worldId, agentId, { body: "p4", worldTimeSec: 20 });
    const p5 = seedPost(worldId, agentId, { body: "p5", worldTimeSec: 30 });

    // 期待される順序: worldTimeSec DESC, postId DESC
    const expected = [p1, p2, p3, p4, p5].sort((a, b) => {
      const timeA = a === p5 ? 30 : a === p1 ? 10 : 20;
      const timeB = b === p5 ? 30 : b === p1 ? 10 : 20;
      if (timeA !== timeB) return timeB - timeA;
      return b.localeCompare(a);
    });

    const collected: string[] = [];
    let cursor: string | undefined;
    let pageCount = 0;

    do {
      const res = getArchivePosts(t.db, worldId, { limit: 2, cursor });
      collected.push(...res.items.map((i) => i.postId));
      cursor = res.nextCursor ?? undefined;
      pageCount += 1;
      expect(pageCount).toBeLessThanOrEqual(4);
    } while (cursor !== undefined);

    expect(pageCount).toBe(3);
    expect(collected).toEqual(expected);
  });

  it("TC-NOUS85_DEV-03 getArchivePosts は別の世界の投稿を混ぜず、非表示（hidden）の投稿も含めて返す", () => {
    const w1 = newUlid(clock.nowMs());
    const w2 = newUlid(clock.nowMs());
    seedWorld(w1, "世界1", "archived", "2026-10-18T00:00:00.000Z");
    seedWorld(w2, "世界2", "archived", "2026-10-19T00:00:00.000Z");

    const a1 = seedAgent(w1, "a1", "エージェント1");
    const a2 = seedAgent(w2, "a2", "エージェント2");

    const w1Public = seedPost(w1, a1, { body: "w1 公開", visibility: "public", worldTimeSec: 10 });
    const w1Hidden = seedPost(w1, a1, { body: "w1 非表示", visibility: "hidden", worldTimeSec: 20 });
    seedPost(w2, a2, { body: "w2 公開", visibility: "public", worldTimeSec: 10 });
    seedPost(w2, a2, { body: "w2 非表示", visibility: "hidden", worldTimeSec: 20 });

    const res = getArchivePosts(t.db, w1, {});
    expect(res.items).toHaveLength(2);
    expect(res.items.map((i) => i.postId)).toEqual([w1Hidden, w1Public]);
    expect(res.items.map((i) => i.visibility)).toEqual(["hidden", "public"]);
  });

  it("TC-NOUS85_DEV-04 getArchivePosts は limit を省略すると既定の 50 件まで取得し、51 件ある場合は nextCursor を返す", () => {
    const worldId = newUlid(clock.nowMs());
    seedWorld(worldId, "世界", "archived", "2026-10-18T00:00:00.000Z");
    const agentId = seedAgent(worldId);

    for (let i = 0; i < 51; i++) {
      seedPost(worldId, agentId, { body: `投稿${i}`, worldTimeSec: i });
    }

    const res = getArchivePosts(t.db, worldId, {});
    expect(res.items).toHaveLength(50);
    expect(res.nextCursor).not.toBeNull();

    const nextRes = getArchivePosts(t.db, worldId, { cursor: res.nextCursor! });
    expect(nextRes.items).toHaveLength(1);
    expect(nextRes.nextCursor).toBeNull();
  });

  it("TC-NOUS85_DEV-05 getArchivePosts は不正な limit（0・101）に 400 VALIDATION_ERROR を投げる", () => {
    const worldId = newUlid(clock.nowMs());
    seedWorld(worldId, "世界", "archived", "2026-10-18T00:00:00.000Z");

    expect(() => getArchivePosts(t.db, worldId, { limit: 0 })).toThrowError(
      expect.objectContaining({ code: "VALIDATION_ERROR" }),
    );
    expect(() => getArchivePosts(t.db, worldId, { limit: 101 })).toThrowError(
      expect.objectContaining({ code: "VALIDATION_ERROR" }),
    );
  });

  it("TC-NOUS85_DEV-06 getArchivePosts は 2 要素でないカーソルに 400 VALIDATION_ERROR を投げる", () => {
    const worldId = newUlid(clock.nowMs());
    seedWorld(worldId, "世界", "archived", "2026-10-18T00:00:00.000Z");

    // 1 要素
    expect(() => getArchivePosts(t.db, worldId, { cursor: encodeCursor(["100"]) })).toThrowError(
      expect.objectContaining({ code: "VALIDATION_ERROR" }),
    );
    // 3 要素
    expect(() => getArchivePosts(t.db, worldId, { cursor: encodeCursor(["100", "postId", "extra"]) })).toThrowError(
      expect.objectContaining({ code: "VALIDATION_ERROR" }),
    );
    // 0 要素
    expect(() => getArchivePosts(t.db, worldId, { cursor: encodeCursor([]) })).toThrowError(
      expect.objectContaining({ code: "VALIDATION_ERROR" }),
    );
  });

  it("TC-NOUS85_DEV-07 getArchivePosts は world_time_sec が整数でないカーソルに 400 VALIDATION_ERROR を投げる", () => {
    const worldId = newUlid(clock.nowMs());
    seedWorld(worldId, "世界", "archived", "2026-10-18T00:00:00.000Z");

    expect(() => getArchivePosts(t.db, worldId, { cursor: encodeCursor(["abc", "postId"]) })).toThrowError(
      expect.objectContaining({ code: "VALIDATION_ERROR" }),
    );
    expect(() => getArchivePosts(t.db, worldId, { cursor: encodeCursor(["12.5", "postId"]) })).toThrowError(
      expect.objectContaining({ code: "VALIDATION_ERROR" }),
    );
    expect(() => getArchivePosts(t.db, worldId, { cursor: encodeCursor(["-5", "postId"]) })).toThrowError(
      expect.objectContaining({ code: "VALIDATION_ERROR" }),
    );
  });
});
