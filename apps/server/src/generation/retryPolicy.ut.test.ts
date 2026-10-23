// 単体テスト（NOUS-104）。観点表は docs/test/unit/NOUS-104/観点表_retryPolicy.json
import { asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SEED_DATE,
  SEED_NOW,
  seedAgent,
  seedEvent,
  seedRunningWorld,
  seedWorld,
} from "../../test/helpers/generationSeed";
import { createTestDb, type TestDb } from "../../test/helpers/testDb";
import type { Clock } from "../clock/clock";
import { FakeClock } from "../clock/fakeClock";
import { daily_usage, generation_attempts } from "../db/schema";
import { CancelledError as ClockCancelledError } from "../lib/errors";
import { createLogger } from "../lib/logger";
import {
  CancelledError as LlmCancelledError,
  FreeTierExceededError,
  InvalidFormatError,
  RateLimitedError,
  ServerError,
  TimeoutError,
  type LlmError,
  type LlmResult,
} from "../llm/llmClient";
import {
  callWithRetry,
  isCancellation,
  StoppedError,
  TemporaryFailureError,
  waitOrStop,
  type RetryContext,
} from "./retryPolicy";

const OK_RESULT: LlmResult = {
  text: '{"action":"none","target":null,"text":null}',
  promptTokens: 500,
  completionTokens: 25,
  neurons: 5.2,
  httpStatus: 200,
  durationMs: 800,
};

/** sleep が張られるまで、Promise の続きを流す（実時間では待たない） */
async function waitForSleeps(clock: FakeClock, count = 1): Promise<void> {
  for (let i = 0; i < 100 && clock.pendingCount() < count; i++) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

/** sleep だけを差し替えた Clock（それ以外は FakeClock に任せる） */
function clockWithSleep(base: FakeClock, sleep: Clock["sleep"]): Clock {
  return {
    now: () => base.now(),
    nowMs: () => base.nowMs(),
    nowIso: () => base.nowIso(),
    sleep,
    setTimer: (ms, cb) => base.setTimer(ms, cb),
    setRepeatingTimer: (ms, cb) => base.setRepeatingTimer(ms, cb),
  } as Clock;
}

describe("retryPolicy（単体テスト）", () => {
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

  const makeCtx = (overrides: Partial<RetryContext> = {}): RetryContext => ({
    db: t.db,
    worldId,
    eventId,
    clock,
    signal: new AbortController().signal,
    shouldContinue: () => true,
    logger: createLogger({ level: "debug", now: () => clock.now(), sinks: [(line) => logLines.push(line)] }),
    ...overrides,
  });

  const attemptsOf = (id: string) =>
    t.db
      .select()
      .from(generation_attempts)
      .where(eq(generation_attempts.event_id, id))
      .orderBy(asc(generation_attempts.attempt_no))
      .all();

  it("TC-UT_RTY-001 waitOrStop は待つ前に signal が abort 済みなら sleep を張らずに CancelledError を投げる", async () => {
    const controller = new AbortController();
    controller.abort();

    const promise = waitOrStop(30_000, controller.signal, clock);

    await expect(promise).rejects.toBeInstanceOf(ClockCancelledError);
    expect(clock.pendingCount()).toBe(0);
  });

  it("TC-UT_RTY-002 waitOrStop は sleep が abort 以外の理由で失敗したら、その例外をそのまま投げる", async () => {
    const boom = new Error("sleep failed");
    const failingClock = clockWithSleep(clock, () => Promise.reject(boom));

    const promise = waitOrStop(30_000, new AbortController().signal, failingClock, new AbortController().signal);

    await expect(promise).rejects.toBe(boom);
  });

  it("TC-UT_RTY-003 waitOrStop は sleep が終わった時点で signal が abort されていれば CancelledError を投げる", async () => {
    const controller = new AbortController();
    const abortingClock = clockWithSleep(clock, async () => {
      controller.abort();
    });

    const promise = waitOrStop(30_000, controller.signal, abortingClock);

    await expect(promise).rejects.toBeInstanceOf(ClockCancelledError);
  });

  it("TC-UT_RTY-004 waitOrStop は sleep が終わった時点で stopSignal が abort されていれば StoppedError を投げる", async () => {
    const stopController = new AbortController();
    const abortingClock = clockWithSleep(clock, async () => {
      stopController.abort();
    });

    const promise = waitOrStop(30_000, new AbortController().signal, abortingClock, stopController.signal);

    await expect(promise).rejects.toBeInstanceOf(StoppedError);
  });

  it("TC-UT_RTY-005 1 回目の失敗の後は 29,999 ミリ秒では呼ばず、30,000 ミリ秒で 2 回目を呼ぶ", async () => {
    let count = 0;
    const promise = callWithRetry(async () => {
      count += 1;
      if (count === 1) throw new TimeoutError("t1");
      return OK_RESULT;
    }, makeCtx());
    await waitForSleeps(clock);

    await clock.advance(29_999);
    const countBefore = count;
    await clock.advance(1);

    expect(countBefore).toBe(1);
    expect(count).toBe(2);
    await expect(promise).resolves.toMatchObject({ attemptNo: 2 });
  });

  it("TC-UT_RTY-006 2 回目の失敗の後は 119,999 ミリ秒では呼ばず、120,000 ミリ秒で 3 回目を呼ぶ", async () => {
    let count = 0;
    const promise = callWithRetry(async () => {
      count += 1;
      if (count <= 2) throw new TimeoutError(`t${count}`);
      return OK_RESULT;
    }, makeCtx());
    await waitForSleeps(clock);
    await clock.advance(30_000);
    await waitForSleeps(clock);

    await clock.advance(119_999);
    const countBefore = count;
    await clock.advance(1);

    expect(countBefore).toBe(2);
    expect(count).toBe(3);
    await expect(promise).resolves.toMatchObject({ attemptNo: 3 });
  });

  it.each([
    { label: "timeout", err: () => new TimeoutError("t"), kind: "timeout", status: null },
    {
      label: "429・3040",
      err: () => new RateLimitedError("r", { httpStatus: 429, detail: "3040" }),
      kind: "rate_limited",
      status: 429,
    },
    { label: "500", err: () => new ServerError("s", { httpStatus: 500 }), kind: "server_error", status: 500 },
    { label: "502", err: () => new ServerError("s", { httpStatus: 502 }), kind: "server_error", status: 502 },
    { label: "503", err: () => new ServerError("s", { httpStatus: 503 }), kind: "server_error", status: 503 },
    {
      label: "success=false（200）",
      err: () => new ServerError("s", { httpStatus: 200 }),
      kind: "server_error",
      status: 200,
    },
  ])(
    "TC-UT_RTY-007 再試行の対象の失敗は 30 秒待って 2 回目を呼び、1 回目の試行をその種類で記録する（$label）",
    async ({ err, kind, status }) => {
      let count = 0;
      const promise = callWithRetry(async () => {
        count += 1;
        if (count === 1) throw err();
        return OK_RESULT;
      }, makeCtx());
      await waitForSleeps(clock);

      await clock.advance(30_000);
      const res = await promise;

      expect(res.attemptNo).toBe(2);
      expect(count).toBe(2);
      expect(attemptsOf(eventId)).toEqual([
        expect.objectContaining({ attempt_no: 1, result: kind, http_status: status }),
      ]);
    },
  );

  it("TC-UT_RTY-008 400 の ServerError は再試行せずに server_error の TemporaryFailureError になる", async () => {
    let count = 0;

    const promise = callWithRetry(async () => {
      count += 1;
      throw new ServerError("bad request", { httpStatus: 400, detail: "invalid input" });
    }, makeCtx());

    await expect(promise).rejects.toMatchObject({
      name: "TemporaryFailureError",
      failureKind: "server_error",
      httpStatus: 400,
    });
    expect(count).toBe(1);
    expect(clock.pendingCount()).toBe(0);
    expect(attemptsOf(eventId)).toEqual([
      expect.objectContaining({
        attempt_no: 1,
        result: "server_error",
        http_status: 400,
        error_detail: "invalid input",
      }),
    ]);
  });

  it("TC-UT_RTY-009 429・3036 は待たずに FreeTierExceededError を投げ、試行を free_tier で記録し daily_usage を 1 回分加算する", async () => {
    let count = 0;

    const promise = callWithRetry(async () => {
      count += 1;
      throw new FreeTierExceededError("free tier", { httpStatus: 429, detail: "code 3036" });
    }, makeCtx());

    await expect(promise).rejects.toBeInstanceOf(FreeTierExceededError);
    expect(count).toBe(1);
    expect(clock.pendingCount()).toBe(0);
    expect(attemptsOf(eventId)).toEqual([
      expect.objectContaining({ attempt_no: 1, result: "free_tier", http_status: 429, error_detail: "code 3036" }),
    ]);
    expect(t.db.select().from(daily_usage).where(eq(daily_usage.usage_date, SEED_DATE)).get()).toMatchObject({
      calls: 1,
      runs: 1,
    });
  });

  it("TC-UT_RTY-010 LlmError でない例外は試行を記録せずにそのまま投げる", async () => {
    const bug = new TypeError("unexpected");

    const promise = callWithRetry(async () => {
      throw bug;
    }, makeCtx());

    await expect(promise).rejects.toBe(bug);
    expect(attemptsOf(eventId)).toHaveLength(0);
    expect(t.db.select().from(daily_usage).all()).toHaveLength(0);
  });

  it("TC-UT_RTY-011 呼び出しが InvalidFormatError を投げたら再試行せず、server_error の TemporaryFailureError にする", async () => {
    let count = 0;

    const promise = callWithRetry(async () => {
      count += 1;
      throw new InvalidFormatError("broken", { detail: "no_json_object" });
    }, makeCtx());

    await expect(promise).rejects.toMatchObject({ name: "TemporaryFailureError", failureKind: "server_error" });
    expect(count).toBe(1);
    expect(attemptsOf(eventId)).toEqual([expect.objectContaining({ result: "invalid_format" })]);
  });

  it("TC-UT_RTY-012 待ちの後、Neurons が日次上限の手前（上限 100 に対して 99.9）なら再試行する", async () => {
    const limitedWorld = seedRunningWorld(t.db, { settings: { daily_neurons_limit: 100, daily_runs_limit: 480 } });
    const limitedEvent = seedEvent(t.db, limitedWorld, seedAgent(t.db, limitedWorld, "haruka"));
    t.db.insert(daily_usage).values({ usage_date: SEED_DATE, calls: 10, runs: 10, neurons: 99.9 }).run();
    let count = 0;
    const promise = callWithRetry(
      async () => {
        count += 1;
        if (count === 1) throw new TimeoutError("t1");
        return OK_RESULT;
      },
      makeCtx({ worldId: limitedWorld, eventId: limitedEvent }),
    );
    await waitForSleeps(clock);

    await clock.advance(30_000);

    await expect(promise).resolves.toMatchObject({ attemptNo: 2 });
    expect(count).toBe(2);
  });

  it("TC-UT_RTY-013 待ちの後、Neurons が日次上限ちょうど（上限 100 に対して 100）なら呼ばずに StoppedError を投げる", async () => {
    const limitedWorld = seedRunningWorld(t.db, { settings: { daily_neurons_limit: 100, daily_runs_limit: 480 } });
    const limitedEvent = seedEvent(t.db, limitedWorld, seedAgent(t.db, limitedWorld, "haruka"));
    t.db.insert(daily_usage).values({ usage_date: SEED_DATE, calls: 10, runs: 10, neurons: 100 }).run();
    let count = 0;
    const promise = callWithRetry(
      async () => {
        count += 1;
        throw new TimeoutError("t");
      },
      makeCtx({ worldId: limitedWorld, eventId: limitedEvent }),
    );
    const assertion = expect(promise).rejects.toBeInstanceOf(StoppedError);
    await waitForSleeps(clock);

    await clock.advance(30_000);

    await assertion;
    expect(count).toBe(1);
  });

  it("TC-UT_RTY-014 world_settings が無いときは ctx.settings の上限で判定し、上限に達していれば StoppedError を投げる", async () => {
    const bareWorld = seedWorld(t.db);
    const bareEvent = seedEvent(t.db, bareWorld, seedAgent(t.db, bareWorld, "haruka"));
    t.db.insert(daily_usage).values({ usage_date: SEED_DATE, calls: 5, runs: 5, neurons: 0 }).run();
    const promise = callWithRetry(
      async () => {
        throw new TimeoutError("t");
      },
      makeCtx({ worldId: bareWorld, eventId: bareEvent, settings: { daily_neurons_limit: 9500, daily_runs_limit: 5 } }),
    );
    const assertion = expect(promise).rejects.toBeInstanceOf(StoppedError);
    await waitForSleeps(clock);

    await clock.advance(30_000);

    await assertion;
  });

  it("TC-UT_RTY-015 world_settings も ctx.settings も無いときは上限を見ずに再試行する", async () => {
    const bareWorld = seedWorld(t.db);
    const bareEvent = seedEvent(t.db, bareWorld, seedAgent(t.db, bareWorld, "haruka"));
    t.db.insert(daily_usage).values({ usage_date: SEED_DATE, calls: 999, runs: 999, neurons: 99_999 }).run();
    let count = 0;
    const promise = callWithRetry(
      async () => {
        count += 1;
        if (count === 1) throw new TimeoutError("t1");
        return OK_RESULT;
      },
      makeCtx({ worldId: bareWorld, eventId: bareEvent }),
    );
    await waitForSleeps(clock);

    await clock.advance(30_000);

    await expect(promise).resolves.toMatchObject({ attemptNo: 2 });
  });

  it("TC-UT_RTY-016 startAttemptNo=3 なら 3 回目と 4 回目の 2 回だけ呼び、4 回目も失敗なら TemporaryFailureError を投げる", async () => {
    let count = 0;
    const promise = callWithRetry(
      async () => {
        count += 1;
        throw new RateLimitedError("r", { httpStatus: 429 });
      },
      makeCtx({ startAttemptNo: 3 }),
    );
    const assertion = expect(promise).rejects.toMatchObject({
      name: "TemporaryFailureError",
      failureKind: "rate_limited",
    });
    await waitForSleeps(clock);

    await clock.advance(30_000);

    await assertion;
    expect(count).toBe(2);
    expect(attemptsOf(eventId).map((a) => a.attempt_no)).toEqual([3, 4]);
    expect(clock.pendingCount()).toBe(0);
  });

  it("TC-UT_RTY-017 呼ぶ前に signal が abort 済みなら、呼ばず・記録せずに CancelledError を投げる", async () => {
    const controller = new AbortController();
    controller.abort();
    let count = 0;

    const promise = callWithRetry(
      async () => {
        count += 1;
        return OK_RESULT;
      },
      makeCtx({ signal: controller.signal }),
    );

    await expect(promise).rejects.toBeInstanceOf(ClockCancelledError);
    expect(count).toBe(0);
    expect(attemptsOf(eventId)).toHaveLength(0);
  });

  it("TC-UT_RTY-018 呼び出し中に signal が abort され、呼び出しが TimeoutError で終わったら cancelled で記録して CancelledError を投げる", async () => {
    const controller = new AbortController();

    const promise = callWithRetry(
      async () => {
        controller.abort();
        throw new TimeoutError("aborted by timeout");
      },
      makeCtx({ signal: controller.signal }),
    );

    await expect(promise).rejects.toBeInstanceOf(ClockCancelledError);
    expect(attemptsOf(eventId)).toEqual([expect.objectContaining({ attempt_no: 1, result: "cancelled" })]);
    expect(clock.pendingCount()).toBe(0);
  });

  it("TC-UT_RTY-019 呼び出しが成功した直後に signal が abort されていたら CancelledError を投げ、試行は記録しない", async () => {
    const controller = new AbortController();

    const promise = callWithRetry(
      async () => {
        controller.abort();
        return OK_RESULT;
      },
      makeCtx({ signal: controller.signal }),
    );

    await expect(promise).rejects.toBeInstanceOf(ClockCancelledError);
    expect(attemptsOf(eventId)).toHaveLength(0);
  });

  it("TC-UT_RTY-020 再試行の待ちの途中で signal が abort されたら、2 回目を呼ばずに CancelledError を投げる", async () => {
    const controller = new AbortController();
    let count = 0;
    const promise = callWithRetry(
      async () => {
        count += 1;
        throw new TimeoutError("t1");
      },
      makeCtx({ signal: controller.signal }),
    );
    const assertion = expect(promise).rejects.toBeInstanceOf(ClockCancelledError);
    await waitForSleeps(clock);

    controller.abort();

    await assertion;
    expect(count).toBe(1);
    expect(attemptsOf(eventId)).toEqual([expect.objectContaining({ attempt_no: 1, result: "timeout" })]);
  });

  it("TC-UT_RTY-021 呼び出し中に stopSignal が abort され、その呼び出しが一時的な失敗なら、待たずに StoppedError を投げる", async () => {
    const stopController = new AbortController();
    let count = 0;

    const promise = callWithRetry(
      async () => {
        count += 1;
        stopController.abort();
        throw new RateLimitedError("r", { httpStatus: 429 });
      },
      makeCtx({ stopSignal: stopController.signal }),
    );

    await expect(promise).rejects.toBeInstanceOf(StoppedError);
    expect(count).toBe(1);
    expect(clock.nowIso()).toBe(SEED_NOW);
    expect(attemptsOf(eventId)).toEqual([expect.objectContaining({ attempt_no: 1, result: "rate_limited" })]);
  });

  it("TC-UT_RTY-022 失敗した試行は warn のログに eventId・attemptNo・kind・httpStatus を出す", async () => {
    const promise = callWithRetry(async () => {
      throw new ServerError("unauthorized", { httpStatus: 401 });
    }, makeCtx());

    await expect(promise).rejects.toBeInstanceOf(TemporaryFailureError);
    const line = logLines.find((l) => l.includes("LLM attempt failed"));
    expect(line).toBeDefined();
    expect(line).toContain(eventId);
    expect(line).toContain("server_error");
    expect(line).toContain("401");
  });

  it.each([
    { label: "時計の CancelledError", err: new ClockCancelledError(), aborted: false, expected: true },
    { label: "LLM の CancelledError", err: new LlmCancelledError("c") as LlmError, aborted: false, expected: true },
    {
      label: "signal が abort 済みの TimeoutError",
      err: new TimeoutError("t") as LlmError,
      aborted: true,
      expected: true,
    },
    {
      label: "abort されていない TimeoutError",
      err: new TimeoutError("t") as LlmError,
      aborted: false,
      expected: false,
    },
  ])(
    "TC-UT_RTY-023 isCancellation は取り消しの例外か signal の abort を取り消しと判定する（$label）",
    ({ err, aborted, expected }) => {
      const controller = new AbortController();
      if (aborted) controller.abort();

      const res = isCancellation(err, controller.signal);

      expect(res).toBe(expected);
    },
  );
});
