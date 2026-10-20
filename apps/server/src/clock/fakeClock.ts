import type { Clock } from "./clock";
import { CancelledError } from "../lib/errors";

interface FakeTimer {
  id: number;
  dueMs: number;
  /** 繰り返しの間隔。1回だけのタイマーと sleep は undefined */
  intervalMs?: number;
  fire: () => void;
}

/** 待ちの間に積まれた Promise の続きを流す（タイマーの中で次の sleep を張る処理を進めるため） */
function flushPending(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/**
 * テスト用の Clock（AISNS_CLOCK=fake、test だけ。基本設計書 9章、テスト計画 8章 T-01）。
 * 時刻は advance・jump でだけ進み、期限の来たタイマーと sleep を時刻の順に解決する
 */
export class FakeClock implements Clock {
  private currentMs: number;
  private nextId = 1;
  private timers: FakeTimer[] = [];

  constructor(start: Date | number = Date.now()) {
    this.currentMs = typeof start === "number" ? start : start.getTime();
  }

  now(): Date {
    return new Date(this.currentMs);
  }

  nowMs(): number {
    return this.currentMs;
  }

  nowIso(): string {
    return this.now().toISOString();
  }

  sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new CancelledError());
        return;
      }
      const onAbort = (): void => {
        cancel();
        reject(new CancelledError());
      };
      const cancel = this.addTimer(ms, () => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      });
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  setTimer(ms: number, callback: () => void): () => void {
    return this.addTimer(ms, callback);
  }

  setRepeatingTimer(ms: number, callback: () => void): () => void {
    if (ms <= 0) throw new RangeError("繰り返しの間隔は 0 より大きくしてください");
    return this.addTimer(ms, callback, ms);
  }

  /**
   * 時刻を ms だけ進める。途中で期限の来たタイマーと sleep を時刻の順に解決し、
   * 解決のたびに現在時刻をその期限に合わせる（周期・00:00 UTC の確認用）
   */
  async advance(ms: number): Promise<void> {
    if (ms < 0) throw new RangeError("時刻は戻せません");
    const targetMs = this.currentMs + ms;
    for (;;) {
      const timer = this.nextDue(targetMs);
      if (!timer) break;
      this.currentMs = Math.max(this.currentMs, timer.dueMs);
      this.fire(timer);
      await flushPending();
    }
    this.currentMs = targetMs;
    await flushPending();
  }

  /** 指定の時刻まで advance する */
  async advanceTo(at: Date | number): Promise<void> {
    const targetMs = typeof at === "number" ? at : at.getTime();
    await this.advance(targetMs - this.currentMs);
  }

  /**
   * スリープからの復帰を再現する。時刻を先に ms だけ飛ばし、その間に期限の来たタイマーを
   * 復帰後の時刻のまま（遅れて）1回ずつ解決する。繰り返しのタイマーは取りこぼした分を重ねて呼ばない
   */
  async jump(ms: number): Promise<void> {
    if (ms < 0) throw new RangeError("時刻は戻せません");
    this.currentMs += ms;
    const due = this.timers.filter((t) => t.dueMs <= this.currentMs).sort(compareTimers);
    for (const timer of due) {
      if (!this.timers.includes(timer)) continue;
      this.fire(timer);
      await flushPending();
    }
    await flushPending();
  }

  /** 張られているタイマーと sleep の数 */
  pendingCount(): number {
    return this.timers.length;
  }

  private addTimer(ms: number, fire: () => void, intervalMs?: number): () => void {
    const timer: FakeTimer = { id: this.nextId++, dueMs: this.currentMs + Math.max(0, ms), intervalMs, fire };
    this.timers.push(timer);
    return () => {
      this.timers = this.timers.filter((t) => t !== timer);
    };
  }

  private nextDue(targetMs: number): FakeTimer | undefined {
    return this.timers.filter((t) => t.dueMs <= targetMs).sort(compareTimers)[0];
  }

  private fire(timer: FakeTimer): void {
    if (timer.intervalMs === undefined) {
      this.timers = this.timers.filter((t) => t !== timer);
    } else {
      // 次の期限は、本来の期限から数えるが、現在時刻より前にはしない（jump の後に重ねて呼ばない）
      let nextMs = timer.dueMs + timer.intervalMs;
      if (nextMs <= this.currentMs) {
        nextMs = this.currentMs + timer.intervalMs;
      }
      timer.dueMs = nextMs;
    }
    timer.fire();
  }
}

function compareTimers(a: FakeTimer, b: FakeTimer): number {
  return a.dueMs - b.dueMs || a.id - b.id;
}
