import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TEST_NOW, seedAdmin, seedSession, testDeps } from "../../../test/helpers/adminTestSupport";
import { createTestDb, type TestDb } from "../../../test/helpers/testDb";
import { FakeClock } from "../../clock/fakeClock";
import { agents, generation_attempts, generation_events, posts, worlds } from "../../db/schema";
import { newUlid } from "../../lib/ids";
import { createAdminApp } from "../adminServer";
import { ADMIN_COOKIE } from "../middleware/sessionAuth";

describe("generationRoutes (/admin/api/generations*)", () => {
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
    worldId = newUlid(clock.nowMs()),
    state: "preparing" | "running" | "paused" | "limit_stopped" | "emergency_stopped" | "archived" = "running",
  ): string {
    const iso = clock.nowIso();
    t.db
      .insert(worlds)
      .values({
        world_id: worldId,
        name: "世界 2026-10-20",
        state,
        running_since: state === "running" ? iso : null,
        created_at: iso,
        started_at: iso,
        archived_at: state === "archived" ? iso : null,
      })
      .run();
    return worldId;
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

  it("TC-NOUS65_DEV-22 GET /admin/api/generations は現在の世界の生成ログを 200 で返し、絞り込みやページ送りができる", async () => {
    const worldId = seedWorld();
    const agentId = seedAgent(worldId);

    const id1 = newUlid(clock.nowMs());
    const id2 = newUlid(clock.nowMs());

    t.db
      .insert(generation_events)
      .values([
        {
          event_id: id1,
          world_id: worldId,
          agent_id: agentId,
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
          event_id: id2,
          world_id: worldId,
          agent_id: agentId,
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
      ])
      .run();

    const a = app();
    const res = await a.request("/admin/api/generations?limit=1", { headers: authHeaders() });
    expect(res.status).toBe(200);

    const body = (await res.json()) as { items: Array<{ eventId: string }>; nextCursor: string | null };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.eventId).toBe(id2);
    expect(body.nextCursor).not.toBeNull();

    const res2 = await a.request(`/admin/api/generations?limit=1&cursor=${body.nextCursor}`, {
      headers: authHeaders(),
    });
    expect(res2.status).toBe(200);
    const body2 = (await res2.json()) as { items: Array<{ eventId: string }>; nextCursor: string | null };
    expect(body2.items).toHaveLength(1);
    expect(body2.items[0]?.eventId).toBe(id1);
    expect(body2.nextCursor).toBeNull();
  });

  it("TC-NOUS65_DEV-23 GET /admin/api/generations は世界が存在しない場合は 200 で空配列と null カーソルを返す", async () => {
    const a = app();
    const res = await a.request("/admin/api/generations", { headers: authHeaders() });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [], nextCursor: null });
  });

  it("TC-NOUS65_DEV-24 GET /admin/api/generations は不正な limit や from > to、不正なカーソルに 400 VALIDATION_ERROR を返す", async () => {
    seedWorld();
    const a = app();

    // limit > 100
    const r1 = await a.request("/admin/api/generations?limit=101", { headers: authHeaders() });
    expect(r1.status).toBe(400);
    expect(await r1.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });

    // from > to
    const r2 = await a.request(
      "/admin/api/generations?from=2026-10-20T12:00:00.000Z&to=2026-10-20T10:00:00.000Z",
      { headers: authHeaders() },
    );
    expect(r2.status).toBe(400);
    expect(await r2.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });

    // 不正なカーソル
    const r3 = await a.request("/admin/api/generations?cursor=invalid-cursor", { headers: authHeaders() });
    expect(r3.status).toBe(400);
    expect(await r3.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
  });

  it("TC-NOUS65_DEV-25 GET /admin/api/generations/:eventId はアーカイブの世界の生成イベント詳細を 200 で返す", async () => {
    const worldId = seedWorld(undefined, "archived");
    const agentId = seedAgent(worldId);
    const eventId = newUlid(clock.nowMs());
    const resultPostId = newUlid(clock.nowMs());
    const iso = clock.nowIso();

    t.db
      .insert(generation_events)
      .values({
        event_id: eventId,
        world_id: worldId,
        agent_id: agentId,
        cycle_no: 1,
        cycle_seed: 123,
        decided_by: "llm",
        action: "post",
        status: "succeeded",
        input_attributes: JSON.stringify({}),
        input_memories: JSON.stringify([]),
        input_post_ids: JSON.stringify([]),
        model_id: "@cf/google/gemma-4-26b-a4b-it",
        prompt_version: "v1",
        llm_mode: "cloudflare",
        world_time_sec: 10,
        started_at: iso,
        finished_at: iso,
        usage_date: "2026-10-20",
      })
      .run();

    t.db
      .insert(posts)
      .values({
        post_id: resultPostId,
        world_id: worldId,
        agent_id: agentId,
        body: "アーカイブの投稿",
        root_post_id: resultPostId,
        depth: 0,
        visibility: "public",
        world_time_sec: 10,
        created_at: iso,
        generation_event_id: eventId,
      })
      .run();

    t.db
      .insert(generation_attempts)
      .values({
        attempt_id: newUlid(clock.nowMs()),
        event_id: eventId,
        attempt_no: 1,
        result: "ok",
        prompt_tokens: 100,
        completion_tokens: 20,
        neurons: 2.0,
        duration_ms: 1000,
        started_at: iso,
      })
      .run();

    const a = app();
    const res = await a.request(`/admin/api/generations/${eventId}`, { headers: authHeaders() });
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      event: { eventId: string; worldId: string };
      attempts: unknown[];
      resultPost: { postId: string };
    };
    expect(body.event.eventId).toBe(eventId);
    expect(body.event.worldId).toBe(worldId);
    expect(body.attempts).toHaveLength(1);
    expect(body.resultPost.postId).toBe(resultPostId);
  });

  it("TC-NOUS65_DEV-26 GET /admin/api/generations/:eventId は JSON 解析失敗時に原文文字列を 200 で返す", async () => {
    const worldId = seedWorld();
    const agentId = seedAgent(worldId);
    const eventId = newUlid(clock.nowMs());
    const iso = clock.nowIso();

    t.db
      .insert(generation_events)
      .values({
        event_id: eventId,
        world_id: worldId,
        agent_id: agentId,
        cycle_no: 1,
        cycle_seed: 123,
        decided_by: "llm",
        action: "post",
        status: "succeeded",
        input_attributes: "broken-json",
        input_memories: "[]",
        input_post_ids: "[]",
        model_id: "@cf/google/gemma-4-26b-a4b-it",
        prompt_version: "v1",
        llm_mode: "cloudflare",
        world_time_sec: 10,
        started_at: iso,
        finished_at: iso,
        usage_date: "2026-10-20",
      })
      .run();

    const a = app();
    const res = await a.request(`/admin/api/generations/${eventId}`, { headers: authHeaders() });
    expect(res.status).toBe(200);

    const body = (await res.json()) as { event: { inputAttributes: unknown } };
    expect(body.event.inputAttributes).toBe("broken-json");
  });

  it("TC-NOUS65_DEV-27 GET /admin/api/generations/:eventId は不正な eventId（26字未満）に 400、存在しない eventId に 404 EVENT_NOT_FOUND を返す", async () => {
    seedWorld();
    const a = app();

    // 26字未満
    const r1 = await a.request("/admin/api/generations/short-id", { headers: authHeaders() });
    expect(r1.status).toBe(400);
    expect(await r1.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });

    // 存在しない eventId
    const r2 = await a.request(`/admin/api/generations/${newUlid(clock.nowMs())}`, { headers: authHeaders() });
    expect(r2.status).toBe(404);
    expect(await r2.json()).toMatchObject({ error: { code: "EVENT_NOT_FOUND" } });
  });
});
