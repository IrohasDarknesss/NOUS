// 単体テスト（NOUS-104）。観点表は docs/test/unit/NOUS-104/観点表_usageRecorder.json
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
  recordAttempt,
  type RecordAttemptInput,
} from "./usageRecorder";

describe("usageRecorder（単体テスト）", () => {
  let t: TestDb;
  let worldId: string;
  let agentId: string;
  let eventId: string;

  beforeEach(() => {
    t = createTestDb();
    worldId = seedWorld(t.db);
    agentId = seedAgent(t.db, worldId, "minato");
    eventId = seedEvent(t.db, worldId, agentId);
  });

  afterEach(() => {
    t.cleanup();
  });

  const baseInput = (overrides: Partial<RecordAttemptInput> = {}): RecordAttemptInput => ({
    eventId,
    attemptNo: 1,
    result: "ok",
    httpStatus: 200,
    promptTokens: 600,
    completionTokens: 40,
    neurons: 6.5,
    durationMs: 500,
    startedAt: SEED_NOW,
    usageDate: SEED_DATE,
    ...overrides,
  });

  const usageOf = (date: string) => t.db.select().from(daily_usage).where(eq(daily_usage.usage_date, date)).get();
  const eventRow = () => t.db.select().from(generation_events).where(eq(generation_events.event_id, eventId)).get();

  it.each([
    { length: 499, expected: 499 },
    { length: 500, expected: 500 },
    { length: 501, expected: 500 },
  ])(
    "TC-UT_USG-001 clipErrorDetail は 500 字以下ならそのまま、501 字なら 500 字に切る（$length 字）",
    ({ length, expected }) => {
      const detail = "x".repeat(length);

      const clipped = clipErrorDetail(detail);

      expect(clipped).toBe("x".repeat(expected));
    },
  );

  it("TC-UT_USG-002 clipErrorDetail は undefined なら null を返す", () => {
    const clipped = clipErrorDetail(undefined);

    expect(clipped).toBeNull();
  });

  it("TC-UT_USG-003 clipErrorDetail はサロゲートペアの字をコードポイントで数え、字の途中で切らない", () => {
    const detail = "\u{1F600}".repeat(501);

    const clipped = clipErrorDetail(detail) ?? "";

    expect([...clipped]).toHaveLength(500);
    expect(clipped).toBe("\u{1F600}".repeat(500));
  });

  it("TC-UT_USG-004 addDailyMetrics は空の差分なら、行が無いときは 0 の行を作り、行があるときは何も変えない", () => {
    withTx(t.db, (tx) => addDailyMetrics(tx, worldId, SEED_DATE, {}));
    const created = t.db.select().from(daily_metrics).where(eq(daily_metrics.world_id, worldId)).get();
    withTx(t.db, (tx) => addDailyMetrics(tx, worldId, SEED_DATE, { runs: 2 }));
    withTx(t.db, (tx) => addDailyMetrics(tx, worldId, SEED_DATE, {}));

    const after = t.db.select().from(daily_metrics).where(eq(daily_metrics.world_id, worldId)).all();

    expect(created).toMatchObject({ runs: 0, posts: 0, nones: 0, failures: 0 });
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ runs: 2, nones: 0 });
  });

  it.each([
    { attemptNo: 1, runs: 1 },
    { attemptNo: 2, runs: 0 },
  ])(
    "TC-UT_USG-005 recordAttempt は isFirstOfEvent を省略すると attemptNo が 1 のときだけ runs を加算する（attemptNo=$attemptNo）",
    ({ attemptNo, runs }) => {
      const input = baseInput({ attemptNo });

      recordAttempt(t.db, input);

      expect(usageOf(SEED_DATE)).toMatchObject({ calls: 1, runs });
    },
  );

  it("TC-UT_USG-006 recordAttempt は isFirstOfEvent を明示すると attemptNo より優先する（1 回目で false なら runs は 0、3 回目で true なら 1）", () => {
    recordAttempt(t.db, baseInput({ attemptNo: 1, isFirstOfEvent: false }));
    const afterFirst = usageOf(SEED_DATE);
    recordAttempt(t.db, baseInput({ attemptNo: 3, isFirstOfEvent: true }));

    const afterSecond = usageOf(SEED_DATE);

    expect(afterFirst).toMatchObject({ calls: 1, runs: 0 });
    expect(afterSecond).toMatchObject({ calls: 2, runs: 1 });
  });

  it("TC-UT_USG-007 addDailyUsage は runs を直接渡すと isFirstOfEvent より優先する", () => {
    withTx(t.db, (tx) => addDailyUsage(tx, SEED_DATE, { isFirstOfEvent: true, runs: 0 }));

    const usage = usageOf(SEED_DATE);

    expect(usage).toMatchObject({ calls: 1, runs: 0 });
  });

  it("TC-UT_USG-008 addDailyUsage は入力を省略すると calls だけ 1 加算し、runs・トークン・Neurons は 0 にする", () => {
    withTx(t.db, (tx) => addDailyUsage(tx, SEED_DATE));

    const usage = usageOf(SEED_DATE);

    expect(usage).toMatchObject({ calls: 1, runs: 0, prompt_tokens: 0, completion_tokens: 0, neurons: 0 });
  });

  it.each([
    { durationMs: -5, expected: 0 },
    { durationMs: 12.9, expected: 12 },
  ])(
    "TC-UT_USG-009 recordAttempt は所要時間が負なら 0、小数なら切り捨てて記録する（$durationMs）",
    ({ durationMs, expected }) => {
      const attemptId = recordAttempt(t.db, baseInput({ durationMs }));

      const attempt = t.db
        .select()
        .from(generation_attempts)
        .where(eq(generation_attempts.attempt_id, attemptId))
        .get();

      expect(attempt?.duration_ms).toBe(expected);
    },
  );

  it("TC-UT_USG-010 recordAttempt は usageDate が違えば daily_usage の別の行に加算する", () => {
    recordAttempt(t.db, baseInput({ usageDate: "2026-10-22" }));
    recordAttempt(t.db, baseInput({ attemptNo: 2, usageDate: "2026-10-23", startedAt: "2026-10-23T00:00:20.000Z" }));

    const day1 = usageOf("2026-10-22");
    const day2 = usageOf("2026-10-23");

    expect(day1).toMatchObject({ calls: 1, runs: 1, neurons: 6.5 });
    expect(day2).toMatchObject({ calls: 1, runs: 0, neurons: 6.5 });
  });

  it("TC-UT_USG-011 recordAttempt は試行の INSERT が CHECK 違反（attempt_no=5）なら daily_usage と生成イベントの合計を変えない", () => {
    const input = baseInput({ attemptNo: 5 });

    expect(() => recordAttempt(t.db, input)).toThrow();

    expect(t.db.select().from(generation_attempts).all()).toHaveLength(0);
    expect(t.db.select().from(daily_usage).all()).toHaveLength(0);
    expect(eventRow()).toMatchObject({ prompt_tokens: 0, completion_tokens: 0, neurons: 0 });
  });

  it("TC-UT_USG-012 不正な形式の試行（LLM は応答している）もトークンと Neurons を試行・daily_usage・生成イベントに加算する", () => {
    const input = baseInput({ result: "invalid_format", errorDetail: "no_json_object" });

    recordAttempt(t.db, input);

    const attempt = t.db.select().from(generation_attempts).where(eq(generation_attempts.event_id, eventId)).get();
    expect(attempt).toMatchObject({
      result: "invalid_format",
      prompt_tokens: 600,
      completion_tokens: 40,
      neurons: 6.5,
    });
    expect(usageOf(SEED_DATE)).toMatchObject({ calls: 1, prompt_tokens: 600, completion_tokens: 40, neurons: 6.5 });
    expect(eventRow()).toMatchObject({ prompt_tokens: 600, completion_tokens: 40, neurons: 6.5 });
  });

  it("TC-UT_USG-013 recordAttempt は同じ生成イベントの ok の試行が続けば、生成イベントのトークン・Neurons を積み上げる", () => {
    recordAttempt(t.db, baseInput({ attemptNo: 1 }));
    recordAttempt(t.db, baseInput({ attemptNo: 2, promptTokens: 400, completionTokens: 10, neurons: 3.5 }));

    const event = eventRow();

    expect(event).toMatchObject({ prompt_tokens: 1000, completion_tokens: 50, neurons: 10 });
  });
});
