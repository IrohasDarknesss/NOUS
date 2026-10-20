import { CancelledError, ConfigError } from "../lib/errors";
import { FakeClock } from "./fakeClock";

export { CancelledError, ConfigError } from "../lib/errors";

/**
 * サーバーの中の時刻の取得は、すべてこの Clock を通す（基本設計書 9章「時計の差し替え」、BE 詳細設計 world 1章・4章）。
 * B01 の周期、B02・B06 の 00:00 UTC、B05 の再試行の待ち、B08 の生存時刻、セッションの期限が対象。
 */
export interface Clock {
  /** 現在時刻 */
  now(): Date;
  /** 現在時刻（エポックからのミリ秒） */
  nowMs(): number;
  /** 現在時刻の ISO 8601（UTC、例 2026-10-20T00:00:00.000Z） */
  nowIso(): string;
  /** ms だけ待つ。signal の abort で CancelledError として拒否する */
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
  /** ms の後に1回だけ callback を呼ぶ。戻り値は解除の関数 */
  setTimer(ms: number, callback: () => void): () => void;
  /** ms ごとに callback を呼ぶ（B08 の 60 秒、セッションの削除の 60 分）。戻り値は解除の関数 */
  setRepeatingTimer(ms: number, callback: () => void): () => void;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** UTC の日付（YYYY-MM-DD）。daily_usage の usage_date に使う */
export function utcDate(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/** 次の 00:00 UTC の時刻。ちょうど 00:00 UTC なら翌日の 00:00 UTC */
export function nextUtcMidnight(at: Date): Date {
  return new Date(Math.floor(at.getTime() / DAY_MS) * DAY_MS + DAY_MS);
}

/** 次の 00:00 UTC までのミリ秒 */
export function msUntilNextUtcMidnight(at: Date): number {
  return nextUtcMidnight(at).getTime() - at.getTime();
}

/**
 * 00:00 UTC ごとに callback を呼ぶ（B02・B06）。毎回 clock の現在時刻から次の 00:00 UTC を求め直すので、
 * スリープからの復帰で遅れても次の日の区切りがずれない。戻り値は解除の関数
 */
export function onUtcMidnight(clock: Clock, callback: () => void): () => void {
  let cancelTimer: () => void = () => {};
  let cancelled = false;
  const arm = (): void => {
    cancelTimer = clock.setTimer(msUntilNextUtcMidnight(clock.now()), () => {
      if (cancelled) return;
      arm();
      callback();
    });
  };
  arm();
  return () => {
    cancelled = true;
    cancelTimer();
  };
}

/** 現在時刻から ms の後の時刻（セッションの期限、next_cycle_at など） */
export function addMs(at: Date, ms: number): Date {
  return new Date(at.getTime() + ms);
}

/** 実時刻の Clock（production・development・既定の test） */
export class SystemClock implements Clock {
  now(): Date {
    return new Date(Date.now());
  }

  nowMs(): number {
    return Date.now();
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
        clearTimeout(handle);
        reject(new CancelledError());
      };
      const handle = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  setTimer(ms: number, callback: () => void): () => void {
    const handle = setTimeout(callback, ms);
    return () => clearTimeout(handle);
  }

  setRepeatingTimer(ms: number, callback: () => void): () => void {
    const handle = setInterval(callback, ms);
    return () => clearInterval(handle);
  }
}

export interface ClockEnv {
  NODE_ENV?: string;
  AISNS_CLOCK?: string;
}

/**
 * AISNS_CLOCK=fake かつ NODE_ENV=test のときだけ FakeClock、それ以外は SystemClock（world 4章 createClock）。
 * production で fake を指定したら ConfigError で起動を止める
 */
export function createClock(env: ClockEnv = process.env): Clock {
  if (env.AISNS_CLOCK === "fake") {
    if (env.NODE_ENV === "test") return new FakeClock();
    if (env.NODE_ENV === "production") {
      throw new ConfigError("AISNS_CLOCK=fake は test 環境だけで使えます（production では使えません）");
    }
  }
  return new SystemClock();
}
