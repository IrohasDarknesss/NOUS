// 単体テスト（NOUS-96）。観点表は docs/test/unit/NOUS-96/観点表_clock.json
import { describe, expect, it, vi } from "vitest";
import { FakeClock } from "./fakeClock";

const START = new Date("2026-10-20T23:58:00.000Z");
const START_MS = START.getTime();

describe("fakeClock（単体テスト）", () => {
  it("TC-UT_CLK-012 開始時刻をエポックからの ms（数値）でも渡せる", () => {
    const clock = new FakeClock(Date.UTC(2026, 9, 22, 9));

    const iso = clock.nowIso();

    expect(iso).toBe("2026-10-22T09:00:00.000Z");
  });

  it("TC-UT_CLK-013 sleep(0) は時刻を進めずに advance(0) で解決する", async () => {
    const clock = new FakeClock(START);
    let done = false;
    void clock.sleep(0).then(() => (done = true));

    await clock.advance(0);

    expect(done).toBe(true);
    expect(clock.nowMs()).toBe(START_MS);
  });

  it("TC-UT_CLK-014 負の ms の sleep は 0 として扱い、advance(0) で解決する", async () => {
    const clock = new FakeClock(START);
    let done = false;
    void clock.sleep(-5000).then(() => (done = true));

    await clock.advance(0);

    expect(done).toBe(true);
    expect(clock.nowMs()).toBe(START_MS);
  });

  it.each([0, -1])("TC-UT_CLK-015 繰り返しの間隔が 0 以下なら RangeError（%j）", (ms) => {
    const clock = new FakeClock(START);

    const act = (): unknown => clock.setRepeatingTimer(ms, () => {});

    expect(act).toThrow(RangeError);
    expect(clock.pendingCount()).toBe(0);
  });

  it("TC-UT_CLK-016 繰り返しの間隔が 1 ms でも受け付け、1 ms ごとに呼ぶ", async () => {
    const clock = new FakeClock(START);
    const callback = vi.fn();
    clock.setRepeatingTimer(1, callback);

    await clock.advance(3);

    expect(callback).toHaveBeenCalledTimes(3);
  });

  it("TC-UT_CLK-017 繰り返しのタイマーは間隔の 1 ms 前では呼ばず、ちょうどで呼ぶ", async () => {
    const clock = new FakeClock(START);
    const callback = vi.fn();
    clock.setRepeatingTimer(60_000, callback);

    await clock.advance(59_999);
    const before = callback.mock.calls.length;
    await clock.advance(1);

    expect(before).toBe(0);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("TC-UT_CLK-018 jump に負の ms を渡すと RangeError で、時刻は変わらない", async () => {
    const clock = new FakeClock(START);

    const pending = clock.jump(-1);

    await expect(pending).rejects.toBeInstanceOf(RangeError);
    expect(clock.nowIso()).toBe("2026-10-20T23:58:00.000Z");
  });

  it("TC-UT_CLK-019 jump(0) は今ちょうど期限のタイマーを呼ぶ", async () => {
    const clock = new FakeClock(START);
    const callback = vi.fn();
    clock.setTimer(0, callback);

    await clock.jump(0);

    expect(callback).toHaveBeenCalledTimes(1);
    expect(clock.pendingCount()).toBe(0);
  });

  it("TC-UT_CLK-020 jump の中で先に呼んだタイマーが後のタイマーを解除したら、後のタイマーは呼ばない", async () => {
    const clock = new FakeClock(START);
    const later = vi.fn();
    const first = vi.fn(() => cancelLater());
    clock.setTimer(1000, first);
    const cancelLater = clock.setTimer(2000, later);

    await clock.jump(5000);

    expect(first).toHaveBeenCalledTimes(1);
    expect(later).not.toHaveBeenCalled();
  });

  it("TC-UT_CLK-021 jump で取りこぼした1回だけのタイマーは、期限の順に復帰後の時刻で呼ぶ", async () => {
    const clock = new FakeClock(START);
    const fired: string[] = [];
    clock.setTimer(3000, () => fired.push(`b@${clock.nowMs() - START_MS}`));
    clock.setTimer(1000, () => fired.push(`a@${clock.nowMs() - START_MS}`));

    await clock.jump(10_000);

    expect(fired).toEqual(["a@10000", "b@10000"]);
  });

  it("TC-UT_CLK-022 advance の中でタイマーが張ったタイマーは、目標の時刻までなら同じ advance で呼び、それより後なら呼ばない", async () => {
    const clock = new FakeClock(START);
    const x = vi.fn(() => clock.nowMs() - START_MS);
    const y = vi.fn();
    clock.setTimer(1000, () => {
      clock.setTimer(500, x);
      clock.setTimer(5000, y);
    });

    await clock.advance(2000);

    expect(x).toHaveBeenCalledTimes(1);
    expect(x.mock.results[0]?.value).toBe(1500);
    expect(y).not.toHaveBeenCalled();
    expect(clock.pendingCount()).toBe(1);
    expect(clock.nowMs() - START_MS).toBe(2000);
  });

  it("TC-UT_CLK-023 解決した後の sleep の signal を abort しても、何も起きない", async () => {
    const clock = new FakeClock(START);
    const ac = new AbortController();
    const pending = clock.sleep(1000, ac.signal);

    await clock.advance(1000);
    ac.abort();

    await expect(pending).resolves.toBeUndefined();
    expect(clock.pendingCount()).toBe(0);
  });

  it("TC-UT_CLK-024 advanceTo は時刻をエポックからの ms（数値）でも受け取る", async () => {
    const clock = new FakeClock(START);

    await clock.advanceTo(Date.UTC(2026, 9, 21));

    expect(clock.nowIso()).toBe("2026-10-21T00:00:00.000Z");
  });

  it("TC-UT_CLK-025 advanceTo に今より前の時刻を渡すと RangeError で、時刻は変わらない", async () => {
    const clock = new FakeClock(START);

    const pending = clock.advanceTo(new Date("2026-10-20T23:57:59.999Z"));

    await expect(pending).rejects.toBeInstanceOf(RangeError);
    expect(clock.nowIso()).toBe("2026-10-20T23:58:00.000Z");
  });
});
