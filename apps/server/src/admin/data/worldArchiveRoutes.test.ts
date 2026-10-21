import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TEST_NOW, seedAdmin, seedSession, testDeps } from "../../../test/helpers/adminTestSupport";
import { createTestDb, type TestDb } from "../../../test/helpers/testDb";
import { FakeClock } from "../../clock/fakeClock";
import { agents, generation_events, posts, worlds } from "../../db/schema";
import { newUlid } from "../../lib/ids";
import { createAdminApp } from "../adminServer";
import { ADMIN_COOKIE } from "../middleware/sessionAuth";

describe("worldArchiveRoutes (/admin/api/worlds*)", () => {
  let t: TestDb;
  let clock: FakeClock;
  let cookie: string;

  beforeEach(() => {
    t = createTestDb();
    clock = new FakeClock(TEST_NOW);
    seedAdmin(t.db, TEST_NOW);
    const s = seedSession(t.db, TEST_NOW);
    cookie = `${ADMIN_COOKIE}=${s.cookie}`;
  });

  afterEach(() => {
    t.cleanup();
  });

  function app() {
    return createAdminApp(testDeps(t.db, clock), { staticDir: null });
  }

  function authHeaders(): Record<string, string> {
    return { Cookie: cookie };
  }

  function seedWorld(
    worldId: string,
    name: string,
    state: "preparing" | "running" | "paused" | "limit_stopped" | "emergency_stopped" | "archived" = "archived",
    createdAt = "2026-10-18T00:00:00.000Z",
    worldElapsedSec = 100,
  ): void {
    t.db
      .insert(worlds)
      .values({
        world_id: worldId,
        name,
        state,
        world_elapsed_sec: worldElapsedSec,
        running_since: null,
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
    body = "テスト本文",
    visibility: "public" | "hidden" = "public",
    worldTimeSec = 10,
    replyToPostId?: string | null,
  ): string {
    const postId = newUlid(clock.nowMs());
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
        world_time_sec: worldTimeSec,
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
        body,
        root_post_id: replyToPostId ?? postId,
        reply_to_post_id: replyToPostId ?? null,
        depth: replyToPostId ? 1 : 0,
        visibility,
        world_time_sec: worldTimeSec,
        created_at: iso,
        generation_event_id: eventId,
      })
      .run();

    return postId;
  }

  it("TC-NOUS65_DEV-31 GET /admin/api/worlds は全ての世界の一覧を created_at の新しい順に 200 で返す", async () => {
    const w1 = newUlid(clock.nowMs());
    const w2 = newUlid(clock.nowMs());
    seedWorld(w1, "世界1", "archived", "2026-10-18T00:00:00.000Z");
    seedWorld(w2, "世界2", "archived", "2026-10-19T00:00:00.000Z");

    const a = app();
    const res = await a.request("/admin/api/worlds", { headers: authHeaders() });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ worldId: string; name: string }> };
    expect(body.items).toHaveLength(2);
    // created_at 降順（w2 -> w1）
    expect(body.items[0]?.worldId).toBe(w2);
    expect(body.items[1]?.worldId).toBe(w1);
  });

  it("TC-NOUS65_DEV-32 GET /admin/api/worlds/:worldId/posts は非表示を含む投稿一覧を 200 で返し、nextCursor でページ送りできる", async () => {
    const worldId = newUlid(clock.nowMs());
    seedWorld(worldId, "アーカイブ世界");
    const agentId = seedAgent(worldId);

    const p1 = seedPost(worldId, agentId, "投稿1", "public", 100);
    const p2 = seedPost(worldId, agentId, "投稿2（非表示）", "hidden", 200);

    const a = app();
    const res = await a.request(`/admin/api/worlds/${worldId}/posts?limit=1`, { headers: authHeaders() });
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      items: Array<{ postId: string; visibility: string }>;
      nextCursor: string | null;
    };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.postId).toBe(p2);
    expect(body.items[0]?.visibility).toBe("hidden");
    expect(body.nextCursor).not.toBeNull();

    const res2 = await a.request(`/admin/api/worlds/${worldId}/posts?limit=1&cursor=${body.nextCursor}`, {
      headers: authHeaders(),
    });
    expect(res2.status).toBe(200);
    const body2 = (await res2.json()) as {
      items: Array<{ postId: string; visibility: string }>;
      nextCursor: string | null;
    };
    expect(body2.items).toHaveLength(1);
    expect(body2.items[0]?.postId).toBe(p1);
    expect(body2.items[0]?.visibility).toBe("public");
    expect(body2.nextCursor).toBeNull();
  });

  it("TC-NOUS65_DEV-33 GET /admin/api/worlds/:worldId/posts は不正な cursor・limit に 400、存在しない世界に 404 WORLD_NOT_FOUND を返す", async () => {
    const worldId = newUlid(clock.nowMs());
    seedWorld(worldId, "世界");

    const a = app();

    // 不正な cursor
    const r1 = await a.request(`/admin/api/worlds/${worldId}/posts?cursor=bad-cursor`, { headers: authHeaders() });
    expect(r1.status).toBe(400);
    expect(await r1.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });

    // 不正な limit (> 100)
    const r2 = await a.request(`/admin/api/worlds/${worldId}/posts?limit=101`, { headers: authHeaders() });
    expect(r2.status).toBe(400);
    expect(await r2.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });

    // 存在しない世界
    const r3 = await a.request(`/admin/api/worlds/${newUlid(clock.nowMs())}/posts`, { headers: authHeaders() });
    expect(r3.status).toBe(404);
    expect(await r3.json()).toMatchObject({ error: { code: "WORLD_NOT_FOUND" } });
  });

  it("TC-NOUS65_DEV-34 GET /admin/api/worlds/:worldId/generations は指定した世界の生成ログを 200 で返し、ページ送りできる", async () => {
    const w1 = newUlid(clock.nowMs());
    const w2 = newUlid(clock.nowMs());
    seedWorld(w1, "世界1");
    seedWorld(w2, "世界2");
    const a1 = seedAgent(w1);
    const a2 = seedAgent(w2);

    const iso = clock.nowIso();
    const g1 = newUlid(clock.nowMs());
    const g2 = newUlid(clock.nowMs());

    t.db
      .insert(generation_events)
      .values([
        {
          event_id: g1,
          world_id: w1,
          agent_id: a1,
          cycle_no: 1,
          cycle_seed: 1,
          decided_by: "llm",
          action: "post",
          status: "succeeded",
          model_id: "@cf/google/gemma-4-26b-a4b-it",
          prompt_version: "v1",
          llm_mode: "cloudflare",
          world_time_sec: 10,
          started_at: "2026-10-20T01:00:00.000Z",
          usage_date: "2026-10-20",
        },
        {
          event_id: g2,
          world_id: w1,
          agent_id: a1,
          cycle_no: 2,
          cycle_seed: 2,
          decided_by: "llm",
          action: "reply",
          status: "succeeded",
          model_id: "@cf/google/gemma-4-26b-a4b-it",
          prompt_version: "v1",
          llm_mode: "cloudflare",
          world_time_sec: 20,
          started_at: "2026-10-20T02:00:00.000Z",
          usage_date: "2026-10-20",
        },
        {
          event_id: newUlid(clock.nowMs()),
          world_id: w2,
          agent_id: a2,
          cycle_no: 1,
          cycle_seed: 3,
          decided_by: "llm",
          action: "like",
          status: "succeeded",
          model_id: "@cf/google/gemma-4-26b-a4b-it",
          prompt_version: "v1",
          llm_mode: "cloudflare",
          world_time_sec: 30,
          started_at: iso,
          usage_date: "2026-10-20",
        },
      ])
      .run();

    const a = app();
    const res = await a.request(`/admin/api/worlds/${w1}/generations?limit=1`, { headers: authHeaders() });
    expect(res.status).toBe(200);

    const body = (await res.json()) as { items: Array<{ eventId: string }>; nextCursor: string | null };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.eventId).toBe(g2);
    expect(body.nextCursor).not.toBeNull();

    const res2 = await a.request(`/admin/api/worlds/${w1}/generations?limit=1&cursor=${body.nextCursor}`, {
      headers: authHeaders(),
    });
    expect(res2.status).toBe(200);
    const body2 = (await res2.json()) as { items: Array<{ eventId: string }>; nextCursor: string | null };
    expect(body2.items).toHaveLength(1);
    expect(body2.items[0]?.eventId).toBe(g1);
    expect(body2.nextCursor).toBeNull();
  });

  it("TC-NOUS65_DEV-35 GET /admin/api/worlds/:worldId/generations は不正な cursor・limit に 400、存在しない世界に 404 WORLD_NOT_FOUND を返す", async () => {
    const worldId = newUlid(clock.nowMs());
    seedWorld(worldId, "世界");

    const a = app();

    // 不正な cursor
    const r1 = await a.request(`/admin/api/worlds/${worldId}/generations?cursor=bad-cursor`, { headers: authHeaders() });
    expect(r1.status).toBe(400);
    expect(await r1.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });

    // 不正な limit (> 100)
    const r2 = await a.request(`/admin/api/worlds/${worldId}/generations?limit=101`, { headers: authHeaders() });
    expect(r2.status).toBe(400);
    expect(await r2.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });

    // 存在しない世界
    const r3 = await a.request(`/admin/api/worlds/${newUlid(clock.nowMs())}/generations`, { headers: authHeaders() });
    expect(r3.status).toBe(404);
    expect(await r3.json()).toMatchObject({ error: { code: "WORLD_NOT_FOUND" } });
  });

  it("TC-NOUS85_DEV-08 GET /admin/api/worlds/:worldId/posts は全項目の揃った投稿データを正しい形式で返す", async () => {
    const worldId = newUlid(clock.nowMs());
    seedWorld(worldId, "アーカイブ世界");
    const agentId = seedAgent(worldId, "minato", "ミナト");

    const parentId = seedPost(worldId, agentId, "親投稿", "public", 100);
    const replyId = seedPost(worldId, agentId, "返信投稿", "hidden", 200, parentId);

    const a = app();
    const res = await a.request(`/admin/api/worlds/${worldId}/posts`, { headers: authHeaders() });
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      items: Array<{
        postId: string;
        body: string;
        visibility: string;
        worldTimeSec: number;
        createdAt: string;
        agent: { agentId: string; displayName: string };
        replyToPostId: string | null;
        generationEventId: string | null;
      }>;
      nextCursor: string | null;
    };

    expect(body.items).toHaveLength(2);
    expect(body.items[0]).toEqual({
      postId: replyId,
      body: "返信投稿",
      visibility: "hidden",
      worldTimeSec: 200,
      createdAt: expect.any(String),
      agent: {
        agentId,
        displayName: "ミナト",
      },
      replyToPostId: parentId,
      generationEventId: expect.any(String),
    });
    expect(body.items[1]?.replyToPostId).toBeNull();
    expect(body.nextCursor).toBeNull();
  });
});
