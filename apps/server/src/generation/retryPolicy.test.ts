import { asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SEED_DATE, SEED_NOW, seedAgent, seedEvent, seedRunningWorld } from "../../test/helpers/generationSeed";
import { createTestDb, type TestDb } from "../../test/helpers/testDb";
import { FakeClock } from "../clock/fakeClock";
import { daily_usage, generation_attempts } from "../db/schema";
import { CancelledError as ClockCancelledError } from "../lib/errors";
import { createLogger } from "../lib/logger";
import {
  CancelledError as LlmCancelledError,
  FreeTierExceededError,
  RateLimitedError,
  ServerError,
  TimeoutError,
  type LlmResult,
} from "../llm/llmClient";
import { callWithRetry, StoppedError, TemporaryFailureError, waitOrStop } from "./retryPolicy";

const OK_RESULT: LlmResult = {
  text: '{"action":"none","target":null,"text":null}',
  promptTokens: 500,
  completionTokens: 25,
  neurons: 5.2,
  httpStatus: 200,
  durationMs: 800,
};

describe("retryPolicy（4章 callWithRetry・waitOrStop・6章）", () => {
  let t: TestDb;
  let worldId: string;
  let agentId: string;
  let eventId: string;
  let clock: FakeClock;
  let logLines: string[];

  beforeEach(() => {
    t = createTestDb();
    worldId = seedRunningWorld(t.db);
    agentId = seedAgent(t.db, worldId, "minato");
    eventId = seedEvent(t.db, worldId, agentId);
    clock = new FakeClock(new Date(SEED_NOW));
    logLines = [];
  });

  afterEach(() => {
    t.cleanup();
  });

  const makeLogger = () =>
    createLogger({
      level: "debug",
      now: () => clock.now(),
      sinks: [(line) => logLines.push(line)],
    });

  it("TC-NOUS63_DEV-07 waitOrStop は指定ミリ秒だけ待ち、abort されたら CancelledError を投げる", async () => {
    const controller = new AbortController();
    const waitPromise = waitOrStop(30_000, controller.signal, clock);
    await clock.advance(30_000);
    await expect(waitPromise).resolves.toBeUndefined();

    const abortController = new AbortController();
    const abortPromise = waitOrStop(30_000, abortController.signal, clock);
    abortController.abort();
    await expect(abortPromise).rejects.toBeInstanceOf(ClockCancelledError);
  });

  it("TC-NOUS63_DEV-08 callWithRetry は 1 回目で成功したとき試行を記録せず結果と attemptNo=1 を返す", async () => {
    const controller = new AbortController();
    const res = await callWithRetry(async () => OK_RESULT, {
      db: t.db,
      worldId,
      eventId,
      clock,
      signal: controller.signal,
      shouldContinue: () => true,
      logger: makeLogger(),
    });

    expect(res).toEqual({
      attemptNo: 1,
      startedAt: SEED_NOW,
      usageDate: SEED_DATE,
      result: OK_RESULT,
    });
    expect(t.db.select().from(generation_attempts).all()).toHaveLength(0);
  });

  it("TC-NOUS63_DEV-09 一時的な失敗は 30 秒・120 秒の順に待ち、3 回目で成功すれば attemptNo=3 を返す", async () => {
    const controller = new AbortController();
    let count = 0;

    const promise = callWithRetry(
      async () => {
        count += 1;
        await clock.advance(100);
        if (count === 1) {
          throw new TimeoutError("timeout 1", { detail: "timed out 60s" });
        }
        if (count === 2) {
          throw new RateLimitedError("rate limit 2", { httpStatus: 429, detail: "code 3040" });
        }
        return OK_RESULT;
      },
      {
        db: t.db,
        worldId,
        eventId,
        clock,
        signal: controller.signal,
        shouldContinue: () => true,
        logger: makeLogger(),
      },
    );

    // 1回目の失敗の後 30 秒、2回目の失敗の後 120 秒進める
    await clock.advance(30_000);
    await clock.advance(120_000);

    const res = await promise;
    expect(res.attemptNo).toBe(3);
    expect(res.result).toEqual(OK_RESULT);

    const attempts = t.db
      .select()
      .from(generation_attempts)
      .where(eq(generation_attempts.event_id, eventId))
      .orderBy(asc(generation_attempts.attempt_no))
      .all();
    expect(attempts).toHaveLength(2);
    expect(attempts[0]).toMatchObject({
      attempt_no: 1,
      result: "timeout",
      http_status: null,
      error_detail: "timed out 60s",
    });
    expect(attempts[1]).toMatchObject({
      attempt_no: 2,
      result: "rate_limited",
      http_status: 429,
      error_detail: "code 3040",
    });

    const usage = t.db.select().from(daily_usage).where(eq(daily_usage.usage_date, SEED_DATE)).get();
    expect(usage).toMatchObject({
      calls: 2,
      runs: 1,
    });
  });

  it("TC-NOUS63_DEV-10 3 回目も一時的な失敗なら記録して最後の失敗種別の TemporaryFailureError を投げる", async () => {
    const controller = new AbortController();
    let count = 0;

    const promise = callWithRetry(
      async () => {
        count += 1;
        if (count === 1) throw new TimeoutError("t1");
        if (count === 2) throw new RateLimitedError("r2", { httpStatus: 429 });
        throw new ServerError("s3", { httpStatus: 503, detail: "service unavailable" });
      },
      {
        db: t.db,
        worldId,
        eventId,
        clock,
        signal: controller.signal,
        shouldContinue: () => true,
        logger: makeLogger(),
      },
    );

    const assertion = expect(promise).rejects.toMatchObject({
      name: "TemporaryFailureError",
      failureKind: "server_error",
      httpStatus: 503,
    });

    await clock.advance(30_000);
    await clock.advance(120_000);
    await assertion;

    const attempts = t.db
      .select()
      .from(generation_attempts)
      .where(eq(generation_attempts.event_id, eventId))
      .orderBy(asc(generation_attempts.attempt_no))
      .all();
    expect(attempts.map((a) => [a.attempt_no, a.result])).toEqual([
      [1, "timeout"],
      [2, "rate_limited"],
      [3, "server_error"],
    ]);
    expect(logLines).toHaveLength(3);
  });

  it("TC-NOUS63_DEV-11 FreeTierExceededError と 400/401 の ServerError は再試行せずに即座に投げる", async () => {
    const controller = new AbortController();

    await expect(
      callWithRetry(
        async () => {
          throw new FreeTierExceededError("daily free tier", { httpStatus: 429, detail: "code 3036" });
        },
        {
          db: t.db,
          worldId,
          eventId,
          clock,
          signal: controller.signal,
          shouldContinue: () => true,
          logger: makeLogger(),
        },
      ),
    ).rejects.toBeInstanceOf(FreeTierExceededError);

    const eventId2 = seedEvent(t.db, worldId, agentId, 2);
    await expect(
      callWithRetry(
        async () => {
          throw new ServerError("unauthorized", { httpStatus: 401, detail: "bad token" });
        },
        {
          db: t.db,
          worldId,
          eventId: eventId2,
          clock,
          signal: controller.signal,
          shouldContinue: () => true,
          logger: makeLogger(),
        },
      ),
    ).rejects.toMatchObject({
      name: "TemporaryFailureError",
      failureKind: "server_error",
      httpStatus: 401,
    });
  });

  it("TC-NOUS63_DEV-12 再試行の待ちの後に shouldContinue() が false または日次上限到達なら StoppedError を投げる", async () => {
    const controller = new AbortController();
    let continuing = true;

    const promise1 = callWithRetry(
      async () => {
        throw new TimeoutError("timeout");
      },
      {
        db: t.db,
        worldId,
        eventId,
        clock,
        signal: controller.signal,
        shouldContinue: () => continuing,
        logger: makeLogger(),
      },
    );

    const assertion1 = expect(promise1).rejects.toBeInstanceOf(StoppedError);
    continuing = false;
    await clock.advance(30_000);
    await assertion1;

    // 日次上限に到達している場合
    const worldIdLimited = seedRunningWorld(t.db, {
      settings: { daily_runs_limit: 1, daily_neurons_limit: 100 },
    });
    const agent2 = seedAgent(t.db, worldIdLimited, "haruka");
    const event2 = seedEvent(t.db, worldIdLimited, agent2);

    const promise2 = callWithRetry(
      async () => {
        throw new RateLimitedError("429", { httpStatus: 429 });
      },
      {
        db: t.db,
        worldId: worldIdLimited,
        eventId: event2,
        clock,
        signal: controller.signal,
        shouldContinue: () => true,
        logger: makeLogger(),
      },
    );

    const assertion2 = expect(promise2).rejects.toBeInstanceOf(StoppedError);
    await clock.advance(30_000);
    await assertion2;
  });

  it("TC-NOUS63_DEV-13 1 つの生成イベントの試行番号が上限 4 に達したら再試行せず TemporaryFailureError にする", async () => {
    const controller = new AbortController();
    let called = 0;

    await expect(
      callWithRetry(
        async () => {
          called += 1;
          throw new TimeoutError("4th attempt timeout");
        },
        {
          db: t.db,
          worldId,
          eventId,
          clock,
          signal: controller.signal,
          shouldContinue: () => true,
          logger: makeLogger(),
          startAttemptNo: 4,
        },
      ),
    ).rejects.toMatchObject({
      name: "TemporaryFailureError",
      failureKind: "timeout",
    });

    expect(called).toBe(1);
    const attempts = t.db.select().from(generation_attempts).where(eq(generation_attempts.event_id, eventId)).all();
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.attempt_no).toBe(4);

    // startAttemptNo が 5 なら呼ばずに TemporaryFailureError
    let called5 = 0;
    await expect(
      callWithRetry(
        async () => {
          called5 += 1;
          return OK_RESULT;
        },
        {
          db: t.db,
          worldId,
          eventId,
          clock,
          signal: controller.signal,
          shouldContinue: () => true,
          logger: makeLogger(),
          startAttemptNo: 5,
          lastFailureKind: "rate_limited",
        },
      ),
    ).rejects.toBeInstanceOf(TemporaryFailureError);
    expect(called5).toBe(0);
  });

  it("TC-NOUS63_DEV-14 LLM の CancelledError または signal.aborted のときは cancelled で記録して投げ直す", async () => {
    const controller = new AbortController();

    await expect(
      callWithRetry(
        async () => {
          throw new LlmCancelledError("aborted");
        },
        {
          db: t.db,
          worldId,
          eventId,
          clock,
          signal: controller.signal,
          shouldContinue: () => true,
          logger: makeLogger(),
        },
      ),
    ).rejects.toBeInstanceOf(LlmCancelledError);

    const attempt = t.db.select().from(generation_attempts).where(eq(generation_attempts.event_id, eventId)).get();
    expect(attempt?.result).toBe("cancelled");
  });

  it("TC-NOUS83_DEV-01 waitOrStop は待機前または待機中に stopSignal が abort されたら StoppedError を投げる", async () => {
    // 待機前に stopSignal が abort されている場合
    const preStopped = new AbortController();
    preStopped.abort();
    const signal1 = new AbortController().signal;
    await expect(waitOrStop(30_000, signal1, clock, preStopped.signal)).rejects.toBeInstanceOf(StoppedError);

    // 待機中に stopSignal が abort された場合（clock.advance しなくても即座に StoppedError）
    const stopCtrl = new AbortController();
    const signal2 = new AbortController().signal;
    const waitPromise = waitOrStop(30_000, signal2, clock, stopCtrl.signal);
    stopCtrl.abort();
    await expect(waitPromise).rejects.toBeInstanceOf(StoppedError);
  });

  it("TC-NOUS83_DEV-02 waitOrStop は signal と stopSignal の両方が abort された場合は signal を優先して CancelledError を投げる", async () => {
    // 待機前に両方 abort されている場合
    const signal1 = new AbortController();
    signal1.abort();
    const stopCtrl1 = new AbortController();
    stopCtrl1.abort();
    await expect(waitOrStop(30_000, signal1.signal, clock, stopCtrl1.signal)).rejects.toBeInstanceOf(
      ClockCancelledError,
    );

    // 待機中に両方 abort された場合
    const signal2 = new AbortController();
    const stopCtrl2 = new AbortController();
    const waitPromise = waitOrStop(30_000, signal2.signal, clock, stopCtrl2.signal);
    stopCtrl2.abort();
    signal2.abort();
    await expect(waitPromise).rejects.toBeInstanceOf(ClockCancelledError);
  });

  it("TC-NOUS83_DEV-03 callWithRetry は一時的な失敗の再試行待ちの途中で stopSignal が abort されたら時計を進めずに StoppedError になり試行は1件だけ記録される", async () => {
    const controller = new AbortController();
    const stopController = new AbortController();
    let callCount = 0;

    const promise = callWithRetry(
      async () => {
        callCount += 1;
        throw new TimeoutError("timeout 1", { detail: "timed out 60s" });
      },
      {
        db: t.db,
        worldId,
        eventId,
        clock,
        signal: controller.signal,
        stopSignal: stopController.signal,
        shouldContinue: () => true,
        logger: makeLogger(),
      },
    );

    // 時計を進めずに stopSignal を abort する
    stopController.abort();
    await expect(promise).rejects.toBeInstanceOf(StoppedError);

    expect(callCount).toBe(1);
    const attempts = t.db.select().from(generation_attempts).where(eq(generation_attempts.event_id, eventId)).all();
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({
      attempt_no: 1,
      result: "timeout",
      error_detail: "timed out 60s",
    });
  });

  it("TC-NOUS83_DEV-04 callWithRetry は stopSignal が渡されない場合は従来どおり再試行の待ちを完了して動作する", async () => {
    const controller = new AbortController();
    let callCount = 0;

    const promise = callWithRetry(
      async () => {
        callCount += 1;
        if (callCount === 1) {
          throw new TimeoutError("timeout 1");
        }
        return OK_RESULT;
      },
      {
        db: t.db,
        worldId,
        eventId,
        clock,
        signal: controller.signal,
        shouldContinue: () => true,
        logger: makeLogger(),
      },
    );

    await clock.advance(30_000);
    const res = await promise;
    expect(res.attemptNo).toBe(2);
    expect(res.result).toEqual(OK_RESULT);
  });

  it("TC-NOUS83_DEV-05 callWithRetry は LLM 呼び出しの最中に stopSignal が abort されても呼び出し完了を待つ", async () => {
    const controller = new AbortController();
    const stopController = new AbortController();

    const res = await callWithRetry(
      async () => {
        // 呼び出し中に stopSignal が abort される
        stopController.abort();
        return OK_RESULT;
      },
      {
        db: t.db,
        worldId,
        eventId,
        clock,
        signal: controller.signal,
        stopSignal: stopController.signal,
        shouldContinue: () => true,
        logger: makeLogger(),
      },
    );

    expect(res.result).toEqual(OK_RESULT);
  });
});
