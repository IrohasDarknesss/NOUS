// 単体テスト（NOUS-96）。観点表は docs/test/unit/NOUS-96/観点表_clock.json
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CancelledError,
  SystemClock,
  addMs,
  createClock,
  msUntilNextUtcMidnight,
  nextUtcMidnight,
  onUtcMidnight,
  utcDate,
  type Clock,
} from "./clock";
import { FakeClock } from "./fakeClock";

const DAY_MS = 24 * 60 * 60 * 1000;
const START = new Date("2026-10-20T23:58:00.000Z");

describe("clock（単体テスト）", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("TC-UT_CLK-001 日の区切りの直前（23:59:59.999）は当日の日付で、次の 00:00 UTC まで 1 ms", () => {
    const at = new Date("2026-10-21T23:59:59.999Z");

    const date = utcDate(at);
    const next = nextUtcMidnight(at);
    const rest = msUntilNextUtcMidnight(at);

    expect(date).toBe("2026-10-21");
    expect(next.toISOString()).toBe("2026-10-22T00:00:00.000Z");
    expect(rest).toBe(1);
  });

  it("TC-UT_CLK-002 ちょうど 00:00:00.000 UTC は新しい日付で、次の区切りまで 24 時間", () => {
    const at = new Date("2026-10-22T00:00:00.000Z");

    const date = utcDate(at);
    const rest = msUntilNextUtcMidnight(at);

    expect(date).toBe("2026-10-22");
    expect(rest).toBe(DAY_MS);
  });

  it("TC-UT_CLK-003 addMs は 0 と負の ms も足し引きし、元の Date を変えない", () => {
    const at = new Date("2026-10-22T00:00:00.000Z");

    const same = addMs(at, 0);
    const before = addMs(at, -1);

    expect(same.toISOString()).toBe("2026-10-22T00:00:00.000Z");
    expect(same).not.toBe(at);
    expect(before.toISOString()).toBe("2026-10-21T23:59:59.999Z");
    expect(at.toISOString()).toBe("2026-10-22T00:00:00.000Z");
  });

  it("TC-UT_CLK-004 env を省略すると process.env を読む", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("AISNS_CLOCK", "fake");

    const clock = createClock();

    expect(clock).toBeInstanceOf(FakeClock);
  });

  it("TC-UT_CLK-005 NODE_ENV が未設定のまま fake を指定したら SystemClock を返し、例外にしない", () => {
    const clock = createClock({ AISNS_CLOCK: "fake" });

    expect(clock).toBeInstanceOf(SystemClock);
  });

  it('TC-UT_CLK-006 AISNS_CLOCK の値は大文字・小文字を区別し、"FAKE" は fake とみなさない', () => {
    const inProduction = createClock({ NODE_ENV: "production", AISNS_CLOCK: "FAKE" });
    const inTest = createClock({ NODE_ENV: "test", AISNS_CLOCK: "FAKE" });

    expect(inProduction).toBeInstanceOf(SystemClock);
    expect(inTest).toBeInstanceOf(SystemClock);
  });

  it("TC-UT_CLK-007 日をまたいで jump したら復帰の時刻に1回だけ呼び、次は翌日の 00:00 UTC に呼ぶ", async () => {
    const clock = new FakeClock(START);
    const at: string[] = [];
    onUtcMidnight(clock, () => at.push(clock.nowIso()));

    await clock.jump(DAY_MS);
    const afterJump = [...at];
    await clock.advance(2 * 60 * 1000);

    expect(afterJump).toEqual(["2026-10-21T23:58:00.000Z"]);
    expect(at).toEqual(["2026-10-21T23:58:00.000Z", "2026-10-22T00:00:00.000Z"]);
  });

  it("TC-UT_CLK-008 callback の中で解除したら、次のタイマーは残らない", async () => {
    const clock = new FakeClock(START);
    const callback = vi.fn(() => cancel());
    const cancel = onUtcMidnight(clock, callback);

    await clock.advance(2 * 60 * 1000 + 2 * DAY_MS);

    expect(callback).toHaveBeenCalledTimes(1);
    expect(clock.pendingCount()).toBe(0);
  });

  it("TC-UT_CLK-009 解除した後にタイマーが発火しても callback を呼ばず、張り直さない", () => {
    const fired: (() => void)[] = [];
    const stub: Clock = {
      now: () => START,
      nowMs: () => START.getTime(),
      nowIso: () => START.toISOString(),
      sleep: () => Promise.resolve(),
      setTimer: vi.fn((_ms: number, cb: () => void) => {
        fired.push(cb);
        return () => {};
      }),
      setRepeatingTimer: () => () => {},
    };
    const callback = vi.fn();
    const cancel = onUtcMidnight(stub, callback);

    cancel();
    fired[0]?.();

    expect(callback).not.toHaveBeenCalled();
    expect(stub.setTimer).toHaveBeenCalledTimes(1);
  });

  it("TC-UT_CLK-010 23:59:59.999 から始めると 1 ms 後の 00:00 UTC に呼ぶ", async () => {
    const clock = new FakeClock(new Date("2026-10-21T23:59:59.999Z"));
    const at: string[] = [];
    onUtcMidnight(clock, () => at.push(clock.nowIso()));

    await clock.advance(1);

    expect(at).toEqual(["2026-10-22T00:00:00.000Z"]);
  });

  it("TC-UT_CLK-011 ちょうど 00:00:00.000 から始めると、その時刻ではなく翌日の 00:00 UTC に呼ぶ", async () => {
    const clock = new FakeClock(new Date("2026-10-22T00:00:00.000Z"));
    const at: string[] = [];
    onUtcMidnight(clock, () => at.push(clock.nowIso()));

    await clock.advance(0);
    await clock.advance(DAY_MS - 1);
    const beforeMidnight = [...at];
    await clock.advance(1);

    expect(beforeMidnight).toEqual([]);
    expect(at).toEqual(["2026-10-23T00:00:00.000Z"]);
  });

  it("TC-UT_CLK-026 abort 済みの signal なら sleep はすぐ拒否し、タイマーを張らない", async () => {
    vi.useFakeTimers();
    const clock = new SystemClock();
    const ac = new AbortController();
    ac.abort();

    const pending = clock.sleep(1000, ac.signal);

    await expect(pending).rejects.toBeInstanceOf(CancelledError);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("TC-UT_CLK-027 解決した後に signal を abort しても拒否にならず、タイマーも残らない", async () => {
    vi.useFakeTimers();
    const clock = new SystemClock();
    const ac = new AbortController();
    const pending = clock.sleep(1000, ac.signal);

    vi.advanceTimersByTime(1000);
    await expect(pending).resolves.toBeUndefined();
    ac.abort();

    await expect(pending).resolves.toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("TC-UT_CLK-028 期限の前に解除した setTimer は呼ばない", () => {
    vi.useFakeTimers();
    const clock = new SystemClock();
    const callback = vi.fn();
    const cancel = clock.setTimer(1000, callback);

    cancel();
    vi.advanceTimersByTime(2000);

    expect(callback).not.toHaveBeenCalled();
  });
});
