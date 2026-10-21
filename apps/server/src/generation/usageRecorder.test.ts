import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SEED_DATE, SEED_NOW, seedAgent, seedEvent, seedWorld } from "../../test/helpers/generationSeed";
import { createTestDb, type TestDb } from "../../test/helpers/testDb";
import { daily_metrics, daily_usage, generation_attempts, generation_events } from "../db/schema";
import { withTx } from "../db/tx";
import {
  addDailyMetrics,
  addDailyUsage,
  clipErrorDetail,
  MAX_ERROR_DETAIL_CHARS,
  metricsForSucceededAction,
  recordAttempt,
} from "./usageRecorder";

describe("usageRecorder（3章・4章 recordAttempt・addDailyUsage・addDailyMetrics）", () => {
  let t: TestDb;
  let worldId: string;
  let agentId: string;

  beforeEach(() => {
    t = createTestDb();
    worldId = seedWorld(t.db);
    agentId = seedAgent(t.db, worldId, "minato");
  });

  afterEach(() => {
    t.cleanup();
  });

  it("TC-NOUS63_DEV-01 recordAttempt（ok・1回目）は generation_attempts・daily_usage・generation_events を 1 トランザクションで更新する", () => {
    const eventId = seedEvent(t.db, worldId, agentId);
    const attemptId = recordAttempt(t.db, {
      eventId,
      attemptNo: 1,
      result: "ok",
      httpStatus: 200,
      promptTokens: 1200,
      completionTokens: 80,
      neurons: 13.5,
      durationMs: 1450,
      startedAt: SEED_NOW,
      usageDate: SEED_DATE,
    });

    expect(attemptId).toHaveLength(26);

    const attempt = t.db.select().from(generation_attempts).where(eq(generation_attempts.attempt_id, attemptId)).get();
    expect(attempt).toMatchObject({
      event_id: eventId,
      attempt_no: 1,
      result: "ok",
      http_status: 200,
      error_detail: null,
      prompt_tokens: 1200,
      completion_tokens: 80,
      neurons: 13.5,
      duration_ms: 1450,
      started_at: SEED_NOW,
    });

    const usage = t.db.select().from(daily_usage).where(eq(daily_usage.usage_date, SEED_DATE)).get();
    expect(usage).toMatchObject({
      usage_date: SEED_DATE,
      calls: 1,
      runs: 1,
      prompt_tokens: 1200,
      completion_tokens: 80,
      neurons: 13.5,
    });

    const event = t.db.select().from(generation_events).where(eq(generation_events.event_id, eventId)).get();
    expect(event).toMatchObject({
      prompt_tokens: 1200,
      completion_tokens: 80,
      neurons: 13.5,
    });
  });

  it("TC-NOUS63_DEV-02 失敗の試行はトークン・neurons を 0 で記録し、2 回目以降の試行では daily_usage.runs を増やさない", () => {
    const eventId = seedEvent(t.db, worldId, agentId);

    // 1回目：timeout（runs+1, calls+1, トークン・neurons は 0）
    recordAttempt(t.db, {
      eventId,
      attemptNo: 1,
      result: "timeout",
      httpStatus: null,
      errorDetail: "request timed out after 60000ms",
      promptTokens: 999,
      completionTokens: 999,
      neurons: 99.9,
      durationMs: 60000,
      startedAt: SEED_NOW,
      usageDate: SEED_DATE,
    });

    // 2回目：invalid_format（runs は増えず 1 のまま、calls は 2）
    recordAttempt(t.db, {
      eventId,
      attemptNo: 2,
      result: "invalid_format",
      httpStatus: 200,
      errorDetail: "no_json_object",
      promptTokens: 500,
      completionTokens: 50,
      neurons: 5,
      durationMs: 1100,
      startedAt: SEED_NOW,
      usageDate: SEED_DATE,
    });

    // 3回目（再生成）：ok（runs は 1 のまま、calls は 3、トークン・neurons が加算される）
    recordAttempt(t.db, {
      eventId,
      attemptNo: 3,
      result: "ok",
      httpStatus: 200,
      promptTokens: 1000,
      completionTokens: 60,
      neurons: 11.2,
      durationMs: 900,
      startedAt: SEED_NOW,
      usageDate: SEED_DATE,
    });

    const usage = t.db.select().from(daily_usage).where(eq(daily_usage.usage_date, SEED_DATE)).get();
    expect(usage).toMatchObject({
      calls: 3,
      runs: 1,
      prompt_tokens: 1000,
      completion_tokens: 60,
      neurons: 11.2,
    });

    const event = t.db.select().from(generation_events).where(eq(generation_events.event_id, eventId)).get();
    expect(event).toMatchObject({
      prompt_tokens: 1000,
      completion_tokens: 60,
      neurons: 11.2,
    });
  });

  it("TC-NOUS63_DEV-03 clipErrorDetail と recordAttempt は error_detail を 500 コードポイントまでに切り詰める", () => {
    const longJapanese = "あ".repeat(650);
    expect([...(clipErrorDetail(longJapanese) ?? "")].length).toBe(MAX_ERROR_DETAIL_CHARS);
    expect(clipErrorDetail(null)).toBeNull();

    const eventId = seedEvent(t.db, worldId, agentId);
    const attemptId = recordAttempt(t.db, {
      eventId,
      attemptNo: 1,
      result: "server_error",
      httpStatus: 500,
      errorDetail: longJapanese,
      durationMs: 250,
      startedAt: SEED_NOW,
      usageDate: SEED_DATE,
    });

    const attempt = t.db.select().from(generation_attempts).where(eq(generation_attempts.attempt_id, attemptId)).get();
    expect([...(attempt?.error_detail ?? "")].length).toBe(500);
  });

  it("TC-NOUS63_DEV-04 addDailyUsage は複数イベントにわたり calls と runs を正しく積み上げる", () => {
    withTx(t.db, (tx) => {
      addDailyUsage(tx, SEED_DATE, { isFirstOfEvent: true, promptTokens: 100, completionTokens: 20, neurons: 1.5 });
      addDailyUsage(tx, SEED_DATE, { isFirstOfEvent: false, promptTokens: 200, completionTokens: 30, neurons: 2.5 });
      addDailyUsage(tx, SEED_DATE, { isFirstOfEvent: true, promptTokens: 300, completionTokens: 40, neurons: 3.0 });
    });

    const usage = t.db.select().from(daily_usage).where(eq(daily_usage.usage_date, SEED_DATE)).get();
    expect(usage).toMatchObject({
      calls: 3,
      runs: 2,
      prompt_tokens: 600,
      completion_tokens: 90,
      neurons: 7.0,
    });
  });

  it("TC-NOUS63_DEV-05 addDailyMetrics は渡された列だけを加算し、他の列を維持する", () => {
    withTx(t.db, (tx) => {
      addDailyMetrics(tx, worldId, SEED_DATE, { nones: 1 });
      addDailyMetrics(tx, worldId, SEED_DATE, { runs: 1, posts: 1 });
      addDailyMetrics(tx, worldId, SEED_DATE, { runs: 1, posts: 1, replies: 1 });
      addDailyMetrics(tx, worldId, SEED_DATE, { runs: 1, likes: 1 });
      addDailyMetrics(tx, worldId, SEED_DATE, { runs: 1, follows: 1 });
      addDailyMetrics(tx, worldId, SEED_DATE, { runs: 1, failures: 1 });
    });

    const row = t.db.select().from(daily_metrics).where(eq(daily_metrics.world_id, worldId)).get();
    expect(row).toMatchObject({
      world_id: worldId,
      usage_date: SEED_DATE,
      runs: 5,
      posts: 2,
      replies: 1,
      replied_posts: 0,
      likes: 1,
      follows: 1,
      nones: 1,
      failures: 1,
    });
  });

  it("TC-NOUS63_DEV-06 metricsForSucceededAction は行動ごとの daily_metrics 加算値を返す", () => {
    expect(metricsForSucceededAction("post")).toEqual({ runs: 1, posts: 1 });
    expect(metricsForSucceededAction("reply")).toEqual({ runs: 1, posts: 1, replies: 1 });
    expect(metricsForSucceededAction("like")).toEqual({ runs: 1, likes: 1 });
    expect(metricsForSucceededAction("follow")).toEqual({ runs: 1, follows: 1 });
    expect(metricsForSucceededAction("unfollow")).toEqual({ runs: 1, follows: 1 });
    expect(metricsForSucceededAction("none")).toEqual({ runs: 1, nones: 1 });
  });
});
