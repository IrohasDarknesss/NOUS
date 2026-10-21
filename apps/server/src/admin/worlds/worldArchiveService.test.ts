import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TEST_NOW, seedAdmin } from "../../../test/helpers/adminTestSupport";
import { createTestDb, type TestDb } from "../../../test/helpers/testDb";
import { FakeClock } from "../../clock/fakeClock";
import { agents, generation_events, posts, worlds } from "../../db/schema";
import { newUlid } from "../../lib/ids";
import { getArchiveGenerations, getArchivePosts, listWorldPosts, listWorldSummaries } from "./worldArchiveService";

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
        root_post_id: postId,
        depth: 0,
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

    const page1 = listWorldPosts(t.db, worldId, { limit: 1 });
    expect(page1.items).toHaveLength(1);
    expect(page1.items[0]?.postId).toBe(p2);
    expect(page1.items[0]?.visibility).toBe("hidden");
    expect(page1.nextCursor).not.toBeNull();

    const page2 = listWorldPosts(t.db, worldId, { limit: 1, cursor: page1.nextCursor! });
    expect(page2.items).toHaveLength(1);
    expect(page2.items[0]?.postId).toBe(p1);
    expect(page2.items[0]?.visibility).toBe("public");
    expect(page2.nextCursor).toBeNull();
  });

  it("TC-NOUS65_DEV-19 listWorldPosts は不正なカーソルに 400 VALIDATION_ERROR を投げる", () => {
    const worldId = newUlid(clock.nowMs());
    seedWorld(worldId, "世界", "archived", "2026-10-18T00:00:00.000Z");

    expect(() => listWorldPosts(t.db, worldId, { cursor: "invalid-cursor" })).toThrowError(
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
});
