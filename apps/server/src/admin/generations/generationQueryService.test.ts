import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TEST_NOW, captureLogger, seedAdmin } from "../../../test/helpers/adminTestSupport";
import { createTestDb, type TestDb } from "../../../test/helpers/testDb";
import { FakeClock } from "../../clock/fakeClock";
import { agents, generation_attempts, generation_events, posts, worlds } from "../../db/schema";
import { encodeCursor } from "../../lib/cursor";
import { AppError } from "../../lib/errors";
import { newUlid } from "../../lib/ids";
import {
  countAttempts,
  decodePairCursor,
  getGenerationDetail,
  listGenerations,
  listGenerationsForWorld,
  parseJsonColumns,
} from "./generationQueryService";

describe("generationQueryService", () => {
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

  function seedWorld(worldId = newUlid(clock.nowMs()), name = "世界 2026-10-20"): string {
    const iso = clock.nowIso();
    t.db
      .insert(worlds)
      .values({
        world_id: worldId,
        name,
        state: "running",
        running_since: iso,
        created_at: iso,
        started_at: iso,
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

  it("TC-NOUS65_DEV-01 listGenerations で (started_at, event_id) の降順に取得され、limit+1 件から nextCursor が作られる", () => {
    const worldId = seedWorld();
    const agentId = seedAgent(worldId);

    const id1 = newUlid(clock.nowMs());
    t.db
      .insert(generation_events)
      .values({
        event_id: id1,
        world_id: worldId,
        agent_id: agentId,
        cycle_no: 1,
        cycle_seed: 101,
        status: "succeeded",
        decided_by: "llm",
        action: "post",
        model_id: "@cf/google/gemma-4-26b-a4b-it",
        prompt_version: "v1",
        llm_mode: "cloudflare",
        world_time_sec: 100,
        started_at: "2026-10-20T01:00:00.000Z",
        finished_at: "2026-10-20T01:00:02.000Z",
        usage_date: "2026-10-20",
      })
      .run();

    const id2 = newUlid(clock.nowMs());
    t.db
      .insert(generation_events)
      .values({
        event_id: id2,
        world_id: worldId,
        agent_id: agentId,
        cycle_no: 2,
        cycle_seed: 102,
        status: "succeeded",
        decided_by: "llm",
        action: "reply",
        model_id: "@cf/google/gemma-4-26b-a4b-it",
        prompt_version: "v1",
        llm_mode: "cloudflare",
        world_time_sec: 200,
        started_at: "2026-10-20T02:00:00.000Z",
        finished_at: "2026-10-20T02:00:02.000Z",
        usage_date: "2026-10-20",
      })
      .run();

    const page1 = listGenerations(t.db, { worldId, limit: 1 });
    expect(page1.rows).toHaveLength(1);
    expect(page1.rows[0]?.event_id).toBe(id2);
    expect(page1.nextCursor).toBe(encodeCursor(["2026-10-20T02:00:00.000Z", id2]));

    const page2 = listGenerations(t.db, { worldId, limit: 1, cursor: page1.nextCursor! });
    expect(page2.rows).toHaveLength(1);
    expect(page2.rows[0]?.event_id).toBe(id1);
    expect(page2.nextCursor).toBeNull();
  });

  it("TC-NOUS65_DEV-02 listGenerations で agentId・action・status・from・to の絞り込みができる", () => {
    const worldId = seedWorld();
    const agent1 = seedAgent(worldId, "agent1", "エージェント1");
    const agent2 = seedAgent(worldId, "agent2", "エージェント2");

    const baseEvent = {
      world_id: worldId,
      cycle_no: 1,
      cycle_seed: 1,
      decided_by: "llm" as const,
      model_id: "@cf/google/gemma-4-26b-a4b-it",
      prompt_version: "v1",
      llm_mode: "cloudflare" as const,
      world_time_sec: 10,
      usage_date: "2026-10-20",
    };

    t.db
      .insert(generation_events)
      .values([
        {
          ...baseEvent,
          event_id: newUlid(clock.nowMs()),
          agent_id: agent1,
          action: "post",
          status: "succeeded",
          started_at: "2026-10-20T10:00:00.000Z",
          finished_at: "2026-10-20T10:00:01.000Z",
        },
        {
          ...baseEvent,
          event_id: newUlid(clock.nowMs()),
          agent_id: agent2,
          action: "reply",
          status: "failed",
          started_at: "2026-10-20T11:00:00.000Z",
          finished_at: "2026-10-20T11:00:01.000Z",
        },
        {
          ...baseEvent,
          event_id: newUlid(clock.nowMs()),
          agent_id: agent1,
          action: "like",
          status: "succeeded",
          started_at: "2026-10-20T12:00:00.000Z",
          finished_at: "2026-10-20T12:00:01.000Z",
        },
      ])
      .run();

    const byAgent = listGenerations(t.db, { worldId, agentId: agent2, limit: 10 });
    expect(byAgent.rows).toHaveLength(1);
    expect(byAgent.rows[0]?.display_name).toBe("エージェント2");

    const byAction = listGenerations(t.db, { worldId, action: "reply", limit: 10 });
    expect(byAction.rows).toHaveLength(1);
    expect(byAction.rows[0]?.action).toBe("reply");

    const byStatus = listGenerations(t.db, { worldId, status: "failed", limit: 10 });
    expect(byStatus.rows).toHaveLength(1);
    expect(byStatus.rows[0]?.status).toBe("failed");

    const byRange = listGenerations(t.db, {
      worldId,
      from: "2026-10-20T10:30:00.000Z",
      to: "2026-10-20T11:30:00.000Z",
      limit: 10,
    });
    expect(byRange.rows).toHaveLength(1);
    expect(byRange.rows[0]?.agent_id).toBe(agent2);
  });

  it("TC-NOUS65_DEV-03 decodePairCursor / listGenerations で不正なカーソルに 400 VALIDATION_ERROR が投げられる", () => {
    const worldId = seedWorld();
    expect(() => decodePairCursor("invalid-base64url!@#")).toThrowError(AppError);
    expect(() => decodePairCursor(Buffer.from(JSON.stringify(["one_element"])).toString("base64url"))).toThrowError(
      AppError,
    );

    expect(() => listGenerations(t.db, { worldId, limit: 10, cursor: "bad_cursor" })).toThrowError(AppError);
  });

  it("TC-NOUS65_DEV-04 countAttempts で event_id ごとの試行回数が正しく集計される", () => {
    const worldId = seedWorld();
    const agentId = seedAgent(worldId);
    const eventId1 = newUlid(clock.nowMs());
    const eventId2 = newUlid(clock.nowMs());
    const iso = clock.nowIso();

    t.db
      .insert(generation_events)
      .values([
        {
          event_id: eventId1,
          world_id: worldId,
          agent_id: agentId,
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
          event_id: eventId2,
          world_id: worldId,
          agent_id: agentId,
          cycle_no: 2,
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

    t.db
      .insert(generation_attempts)
      .values([
        {
          attempt_id: newUlid(clock.nowMs()),
          event_id: eventId1,
          attempt_no: 1,
          result: "timeout",
          duration_ms: 1000,
          started_at: iso,
        },
        {
          attempt_id: newUlid(clock.nowMs()),
          event_id: eventId1,
          attempt_no: 2,
          result: "ok",
          duration_ms: 800,
          started_at: iso,
        },
        {
          attempt_id: newUlid(clock.nowMs()),
          event_id: eventId2,
          attempt_no: 1,
          result: "ok",
          duration_ms: 500,
          started_at: iso,
        },
      ])
      .run();

    const counts = countAttempts(t.db, [eventId1, eventId2, "non_existent"]);
    expect(counts.get(eventId1)).toBe(2);
    expect(counts.get(eventId2)).toBe(1);
    expect(counts.get("non_existent")).toBeUndefined();
  });

  it("TC-NOUS65_DEV-05 listGenerationsForWorld で attemptCount と hasConsistencyFlags が正しく設定される", () => {
    const worldId = seedWorld();
    const agentId = seedAgent(worldId);
    const eventId1 = newUlid(clock.nowMs());
    const eventId2 = newUlid(clock.nowMs());
    const iso = clock.nowIso();

    t.db
      .insert(generation_events)
      .values([
        {
          event_id: eventId1,
          world_id: worldId,
          agent_id: agentId,
          cycle_no: 1,
          cycle_seed: 1,
          decided_by: "llm",
          status: "succeeded",
          consistency_flags: JSON.stringify([{ code: "C01", detail: "矛盾あり" }]),
          model_id: "@cf/google/gemma-4-26b-a4b-it",
          prompt_version: "v1",
          llm_mode: "cloudflare",
          world_time_sec: 10,
          started_at: "2026-10-20T10:00:00.000Z",
          finished_at: "2026-10-20T10:00:01.000Z",
          usage_date: "2026-10-20",
        },
        {
          event_id: eventId2,
          world_id: worldId,
          agent_id: agentId,
          cycle_no: 2,
          cycle_seed: 2,
          decided_by: "llm",
          status: "succeeded",
          consistency_flags: JSON.stringify([]),
          model_id: "@cf/google/gemma-4-26b-a4b-it",
          prompt_version: "v1",
          llm_mode: "cloudflare",
          world_time_sec: 20,
          started_at: "2026-10-20T11:00:00.000Z",
          finished_at: "2026-10-20T11:00:01.000Z",
          usage_date: "2026-10-20",
        },
      ])
      .run();

    t.db
      .insert(generation_attempts)
      .values({
        attempt_id: newUlid(clock.nowMs()),
        event_id: eventId1,
        attempt_no: 1,
        result: "ok",
        duration_ms: 1200,
        started_at: iso,
      })
      .run();

    const res = listGenerationsForWorld(t.db, worldId, {});
    expect(res.items).toHaveLength(2);

    const item2 = res.items.find((i) => i.eventId === eventId2);
    expect(item2?.attemptCount).toBe(0);
    expect(item2?.hasConsistencyFlags).toBe(false);

    const item1 = res.items.find((i) => i.eventId === eventId1);
    expect(item1?.attemptCount).toBe(1);
    expect(item1?.hasConsistencyFlags).toBe(true);
  });

  it("TC-NOUS65_DEV-06 getGenerationDetail で attempts, refPosts (P1, P2.. と excerpt 40字), resultPost が正しく取得できる", () => {
    const worldId = seedWorld();
    const agentId = seedAgent(worldId);
    const eventId = newUlid(clock.nowMs());
    const refPostId1 = newUlid(clock.nowMs());
    const refPostId2 = newUlid(clock.nowMs());
    const resultPostId = newUlid(clock.nowMs());
    const iso = clock.nowIso();

    const longBody = "あ".repeat(50);
    t.db
      .insert(posts)
      .values([
        {
          post_id: refPostId1,
          world_id: worldId,
          agent_id: agentId,
          body: longBody,
          root_post_id: refPostId1,
          depth: 0,
          visibility: "public",
          world_time_sec: 50,
          created_at: iso,
          generation_event_id: newUlid(clock.nowMs()),
        },
        {
          post_id: refPostId2,
          world_id: worldId,
          agent_id: agentId,
          body: "短い投稿",
          root_post_id: refPostId2,
          depth: 0,
          visibility: "public",
          world_time_sec: 60,
          created_at: iso,
          generation_event_id: newUlid(clock.nowMs()),
        },
      ])
      .run();

    t.db
      .insert(generation_events)
      .values({
        event_id: eventId,
        world_id: worldId,
        agent_id: agentId,
        cycle_no: 5,
        cycle_seed: 999,
        status: "succeeded",
        decided_by: "llm",
        action: "reply",
        action_candidates: JSON.stringify(["reply", "like"]),
        input_attributes: JSON.stringify({ mood: "good" }),
        input_memories: JSON.stringify(["memory1"]),
        input_post_ids: JSON.stringify([refPostId1, refPostId2]),
        prompt_text: "プロンプト",
        output_text: "返答",
        model_id: "@cf/google/gemma-4-26b-a4b-it",
        prompt_version: "v1",
        llm_mode: "cloudflare",
        prompt_tokens: 100,
        completion_tokens: 20,
        neurons: 5.5,
        cost_jpy: 0,
        consistency_flags: null,
        world_time_sec: 100,
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
        body: "生成されたリプライ",
        reply_to_post_id: refPostId1,
        root_post_id: refPostId1,
        depth: 1,
        visibility: "public",
        world_time_sec: 100,
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
        http_status: 200,
        error_detail: null,
        prompt_tokens: 100,
        completion_tokens: 20,
        neurons: 5.5,
        duration_ms: 1500,
        started_at: iso,
      })
      .run();

    const { logger } = captureLogger();
    const detail = getGenerationDetail(t.db, logger, eventId);

    expect(detail.event.eventId).toBe(eventId);
    expect(detail.event.actionCandidates).toEqual(["reply", "like"]);
    expect(detail.event.inputAttributes).toEqual({ mood: "good" });
    expect(detail.attempts).toHaveLength(1);
    expect(detail.attempts[0]?.attemptNo).toBe(1);

    expect(detail.refPosts).toEqual([
      { label: "P1", postId: refPostId1, excerpt: "あ".repeat(40) },
      { label: "P2", postId: refPostId2, excerpt: "短い投稿" },
    ]);

    expect(detail.resultPost).toEqual({
      postId: resultPostId,
      body: "生成されたリプライ",
      visibility: "public",
    });
  });

  it("TC-NOUS65_DEV-36 getGenerationDetail の refPosts は、見つからない投稿があっても入力での位置の P 番号を保つ", () => {
    const worldId = seedWorld();
    const agentId = seedAgent(worldId);
    const eventId = newUlid(clock.nowMs());
    const missingPostId = newUlid(clock.nowMs());
    const refPostId = newUlid(clock.nowMs());
    const iso = clock.nowIso();

    t.db
      .insert(posts)
      .values({
        post_id: refPostId,
        world_id: worldId,
        agent_id: agentId,
        body: "残っている投稿",
        root_post_id: refPostId,
        depth: 0,
        visibility: "public",
        world_time_sec: 60,
        created_at: iso,
        generation_event_id: newUlid(clock.nowMs()),
      })
      .run();
    t.db
      .insert(generation_events)
      .values({
        event_id: eventId,
        world_id: worldId,
        agent_id: agentId,
        cycle_no: 5,
        cycle_seed: 999,
        status: "succeeded",
        decided_by: "llm",
        action: "like",
        input_post_ids: JSON.stringify([missingPostId, refPostId]),
        model_id: "@cf/google/gemma-4-26b-a4b-it",
        prompt_version: "v1",
        llm_mode: "fixed",
        world_time_sec: 100,
        started_at: iso,
        finished_at: iso,
        usage_date: "2026-10-20",
      })
      .run();

    const { logger } = captureLogger();
    const detail = getGenerationDetail(t.db, logger, eventId);

    expect(detail.refPosts).toEqual([{ label: "P2", postId: refPostId, excerpt: "残っている投稿" }]);
    expect(detail.resultPost).toBeNull();
  });
  it("TC-NOUS65_DEV-07 getGenerationDetail で存在しない eventId に 404 EVENT_NOT_FOUND が投げられる", () => {
    const { logger } = captureLogger();
    expect(() => getGenerationDetail(t.db, logger, newUlid(clock.nowMs()))).toThrowError(
      expect.objectContaining({ code: "EVENT_NOT_FOUND" }),
    );
  });

  it("TC-NOUS65_DEV-08 parseJsonColumns / getGenerationDetail で JSON 解析失敗時に原文文字列のまま返り logger.warn が記録される", () => {
    const { logger, lines } = captureLogger();
    const raw = parseJsonColumns(logger, {
      event_id: "test-event",
      input_attributes: "not-json-attributes",
      input_memories: "[]",
      input_post_ids: "[]",
      action_candidates: null,
      consistency_flags: "bad-flags",
    });

    expect(raw.inputAttributes).toBe("not-json-attributes");
    expect(raw.inputMemories).toEqual([]);
    expect(raw.consistencyFlags).toBe("bad-flags");

    const warns = lines().filter((l) => l.level === "warn");
    expect(warns).toHaveLength(2);
    expect(warns[0]?.msg).toBe("generation_json_parse_failed");
    expect(warns[0]?.eventId).toBe("test-event");
  });

  it("TC-NOUS65_DEV-09 getGenerationDetail で失敗した生成や post/reply 以外では resultPost が null になる", () => {
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
        cycle_seed: 1,
        status: "failed",
        decided_by: "llm",
        action: "post",
        model_id: "@cf/google/gemma-4-26b-a4b-it",
        prompt_version: "v1",
        llm_mode: "cloudflare",
        world_time_sec: 10,
        started_at: iso,
        usage_date: "2026-10-20",
      })
      .run();

    const { logger } = captureLogger();
    const detail = getGenerationDetail(t.db, logger, eventId);
    expect(detail.resultPost).toBeNull();
  });
});
