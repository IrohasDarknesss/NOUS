import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CancelledError,
  ConfigError,
  SystemClock,
  addMs,
  createClock,
  msUntilNextUtcMidnight,
  nextUtcMidnight,
  onUtcMidnight,
  utcDate,
} from "./clock";
import { FakeClock } from "./fakeClock";

const START = new Date("2026-10-20T23:58:00.000Z");

describe("createClock", () => {
  it("TC-NOUS45_DEV-01 AISNS_CLOCK=fake かつ NODE_ENV=test のときだけ FakeClock を返す", () => {
    expect(createClock({ NODE_ENV: "test", AISNS_CLOCK: "fake" })).toBeInstanceOf(FakeClock);
  });

  it("TC-NOUS45_DEV-02 AISNS_CLOCK が未指定・system なら SystemClock を返す", () => {
    expect(createClock({ NODE_ENV: "test" })).toBeInstanceOf(SystemClock);
    expect(createClock({ NODE_ENV: "test", AISNS_CLOCK: "system" })).toBeInstanceOf(SystemClock);
    expect(createClock({ NODE_ENV: "production" })).toBeInstanceOf(SystemClock);
  });

  it("TC-NOUS45_DEV-03 development で fake を指定しても SystemClock を返す", () => {
    expect(createClock({ NODE_ENV: "development", AISNS_CLOCK: "fake" })).toBeInstanceOf(SystemClock);
  });

  it("TC-NOUS45_DEV-04 production で fake を指定すると ConfigError", () => {
    expect(() => createClock({ NODE_ENV: "production", AISNS_CLOCK: "fake" })).toThrow(ConfigError);
  });
});

describe("UTC の日付の補助", () => {
  it("TC-NOUS45_DEV-05 utcDate は UTC の日付を返す", () => {
    expect(utcDate(new Date("2026-10-20T23:59:59.999Z"))).toBe("2026-10-20");
    expect(utcDate(new Date("2026-10-21T00:00:00.000Z"))).toBe("2026-10-21");
  });

  it("TC-NOUS45_DEV-06 nextUtcMidnight は次の 00:00 UTC、ちょうど 00:00 なら翌日", () => {
    expect(nextUtcMidnight(START).toISOString()).toBe("2026-10-21T00:00:00.000Z");
    expect(nextUtcMidnight(new Date("2026-10-21T00:00:00.000Z")).toISOString()).toBe("2026-10-22T00:00:00.000Z");
    expect(msUntilNextUtcMidnight(START)).toBe(2 * 60 * 1000);
  });

  it("TC-NOUS45_DEV-07 addMs は ms の後の時刻を返す", () => {
    expect(addMs(START, 60_000).toISOString()).toBe("2026-10-20T23:59:00.000Z");
  });
});

describe("FakeClock", () => {
  it("TC-NOUS45_DEV-08 時刻は advance でだけ進む", async () => {
    const clock = new FakeClock(START);
    expect(clock.nowIso()).toBe("2026-10-20T23:58:00.000Z");
    expect(clock.nowMs()).toBe(START.getTime());
    await clock.advance(1500);
    expect(clock.now().toISOString()).toBe("2026-10-20T23:58:01.500Z");
  });

  it("TC-NOUS45_DEV-09 sleep は期限まで進めたときに解決する", async () => {
    const clock = new FakeClock(START);
    let done = false;
    void clock.sleep(30_000).then(() => (done = true));
    await clock.advance(29_999);
    expect(done).toBe(false);
    await clock.advance(1);
    expect(done).toBe(true);
    expect(clock.pendingCount()).toBe(0);
  });

  it("TC-NOUS45_DEV-10 sleep は signal の abort で CancelledError として拒否する", async () => {
    const clock = new FakeClock(START);
    const ac = new AbortController();
    const p = clock.sleep(120_000, ac.signal);
    ac.abort();
    await expect(p).rejects.toBeInstanceOf(CancelledError);
    expect(clock.pendingCount()).toBe(0);
  });

  it("TC-NOUS45_DEV-11 abort 済みの signal なら sleep はすぐ拒否する", async () => {
    const clock = new FakeClock(START);
    const ac = new AbortController();
    ac.abort();
    await expect(clock.sleep(1000, ac.signal)).rejects.toBeInstanceOf(CancelledError);
  });

  it("TC-NOUS45_DEV-12 タイマーは期限の順に、その時刻で発火する", async () => {
    const clock = new FakeClock(START);
    const fired: string[] = [];
    clock.setTimer(3000, () => fired.push(`b@${clock.nowMs() - START.getTime()}`));
    clock.setTimer(1000, () => fired.push(`a@${clock.nowMs() - START.getTime()}`));
    clock.setTimer(3000, () => fired.push(`c@${clock.nowMs() - START.getTime()}`));
    await clock.advance(5000);
    expect(fired).toEqual(["a@1000", "b@3000", "c@3000"]);
  });

  it("TC-NOUS45_DEV-13 解除したタイマーは発火しない", async () => {
    const clock = new FakeClock(START);
    const cb = vi.fn();
    const cancel = clock.setTimer(1000, cb);
    cancel();
    await clock.advance(2000);
    expect(cb).not.toHaveBeenCalled();
  });

  it("TC-NOUS45_DEV-14 繰り返しのタイマーは間隔ごとに発火する（B08 の 60 秒）", async () => {
    const clock = new FakeClock(START);
    const cb = vi.fn();
    const cancel = clock.setRepeatingTimer(60_000, cb);
    await clock.advance(180_000);
    expect(cb).toHaveBeenCalledTimes(3);
    cancel();
    await clock.advance(60_000);
    expect(cb).toHaveBeenCalledTimes(3);
  });

  it("TC-NOUS45_DEV-15 sleep の後に張った次の sleep も、同じ advance の中で解決する（周期の連続）", async () => {
    const clock = new FakeClock(START);
    const wakes: number[] = [];
    void (async () => {
      for (let i = 0; i < 3; i++) {
        await clock.sleep(10_000);
        wakes.push(clock.nowMs() - START.getTime());
      }
    })();
    await clock.advance(30_000);
    expect(wakes).toEqual([10_000, 20_000, 30_000]);
  });

  it("TC-NOUS45_DEV-16 onUtcMidnight は 00:00 UTC ごとに発火する（B02・B06）", async () => {
    const clock = new FakeClock(START);
    const at: string[] = [];
    const cancel = onUtcMidnight(clock, () => at.push(clock.nowIso()));
    await clock.advance(2 * 60 * 1000 + 24 * 60 * 60 * 1000);
    expect(at).toEqual(["2026-10-21T00:00:00.000Z", "2026-10-22T00:00:00.000Z"]);
    cancel();
    await clock.advance(24 * 60 * 60 * 1000);
    expect(at).toHaveLength(2);
  });

  it("TC-NOUS45_DEV-17 jump はスリープからの復帰を再現し、取りこぼしたタイマーを復帰後の時刻で1回ずつ呼ぶ", async () => {
    const clock = new FakeClock(START);
    const beats: number[] = [];
    clock.setRepeatingTimer(60_000, () => beats.push(clock.nowMs() - START.getTime()));
    await clock.jump(10 * 60_000);
    expect(beats).toEqual([600_000]);
    await clock.advance(60_000);
    expect(beats).toEqual([600_000, 660_000]);
  });

  it("TC-NOUS45_DEV-18 advanceTo は指定の時刻まで進め、時刻を戻す指定は RangeError", async () => {
    const clock = new FakeClock(START);
    await clock.advanceTo(new Date("2026-10-21T00:00:00.000Z"));
    expect(clock.nowIso()).toBe("2026-10-21T00:00:00.000Z");
    await expect(clock.advance(-1)).rejects.toBeInstanceOf(RangeError);
  });
});

describe("SystemClock", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("TC-NOUS45_DEV-19 now・nowIso は実時刻を返す", () => {
    vi.useFakeTimers({ now: START });
    const clock = new SystemClock();
    expect(clock.nowIso()).toBe("2026-10-20T23:58:00.000Z");
    expect(clock.nowMs()).toBe(START.getTime());
  });

  it("TC-NOUS45_DEV-20 sleep は ms の後に解決し、abort で CancelledError", async () => {
    vi.useFakeTimers();
    const clock = new SystemClock();
    const ok = clock.sleep(1000);
    vi.advanceTimersByTime(1000);
    await expect(ok).resolves.toBeUndefined();
    const ac = new AbortController();
    const ng = clock.sleep(1000, ac.signal);
    ac.abort();
    await expect(ng).rejects.toBeInstanceOf(CancelledError);
  });

  it("TC-NOUS45_DEV-21 setTimer・setRepeatingTimer は解除の関数を返す", () => {
    vi.useFakeTimers();
    const clock = new SystemClock();
    const once = vi.fn();
    const repeat = vi.fn();
    clock.setTimer(1000, once);
    const cancel = clock.setRepeatingTimer(1000, repeat);
    vi.advanceTimersByTime(3000);
    cancel();
    vi.advanceTimersByTime(3000);
    expect(once).toHaveBeenCalledTimes(1);
    expect(repeat).toHaveBeenCalledTimes(3);
  });
});
