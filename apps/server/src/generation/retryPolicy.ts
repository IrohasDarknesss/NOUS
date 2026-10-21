// LLM の再試行と待機・停止判定（BE 詳細設計 generation 2章・4章 callWithRetry・waitOrStop・6章、
// 基本設計書 概要 5章「異常系1：LLM の失敗と再試行」・8章 B05）。
import { eq } from "drizzle-orm";
import { utcDate, type Clock } from "../clock/clock";
import type { Db } from "../db/client";
import { world_settings } from "../db/schema";
import { CancelledError as ClockCancelledError } from "../lib/errors";
import type { Logger } from "../lib/logger";
import {
  CancelledError as LlmCancelledError,
  FreeTierExceededError,
  isLlmError,
  type LlmResult,
} from "../llm/llmClient";
import { isWithinLimits, type UsageLimits } from "../world/limits";
import { getUsage } from "../world/worldService";
import { recordAttempt } from "./usageRecorder";

/** 再試行の待ち時間（1回目の失敗の後 30 秒、2回目の失敗の後 120 秒） */
export const RETRY_DELAYS_MS = [30_000, 120_000] as const;

/** 1 つの生成イベントあたりの試行の上限（generation_attempts.attempt_no の CHECK は 1〜4） */
export const MAX_EVENT_ATTEMPTS = 4;

export type TemporaryFailureKind = "timeout" | "rate_limited" | "server_error";

/** 再試行の待ちの後に世界が止まっていた・日次の上限に達していたときの例外 */
export class StoppedError extends Error {
  constructor(message = "Stopped while waiting for retry") {
    super(message);
    this.name = "StoppedError";
  }
}

/** 一時的な失敗で再試行を使い切ったとき（または 400/401 等の server_error）の例外 */
export class TemporaryFailureError extends Error {
  readonly failureKind: TemporaryFailureKind;
  readonly httpStatus: number | null;
  readonly detail: string | null;

  constructor(
    failureKind: TemporaryFailureKind,
    message = `LLM temporary failure: ${failureKind}`,
    options: { httpStatus?: number | null; detail?: string | null; cause?: unknown } = {},
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "TemporaryFailureError";
    this.failureKind = failureKind;
    this.httpStatus = options.httpStatus ?? null;
    this.detail = options.detail ?? null;
  }
}

export type RetryContext = {
  db: Db;
  worldId: string;
  eventId: string;
  clock: Clock;
  signal: AbortSignal;
  /** 再試行の待ちだけを打ち切る signal（一時停止・上限停止用） */
  stopSignal?: AbortSignal;
  shouldContinue: () => boolean;
  logger: Logger;
  /** world_settings が DB に無い単体テスト用のフォールバック */
  settings?: UsageLimits;
  /** この呼び出しの最初の attempt_no（省略時は 1。再生成のときは直前の続きの番号を渡す） */
  startAttemptNo?: number;
  /** 試行番号が上限（4）に達していて呼べないときに使う失敗の種類 */
  lastFailureKind?: TemporaryFailureKind;
};

export type CallWithRetryResult = {
  attemptNo: number;
  startedAt: string;
  usageDate: string;
  result: LlmResult;
};

/** 取り消し例外または signal.aborted かどうかを判定する（時計と LLM の 2 種類の CancelledError に対応） */
export function isCancellation(err: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  return err instanceof ClockCancelledError || err instanceof LlmCancelledError;
}

/**
 * 指定ミリ秒だけ待つ。途中で signal が abort されたら CancelledError、stopSignal なら StoppedError を投げる（4章 waitOrStop）。
 */
export async function waitOrStop(
  ms: number,
  signal: AbortSignal,
  clock: Clock,
  stopSignal?: AbortSignal,
): Promise<void> {
  if (signal.aborted) {
    throw new ClockCancelledError();
  }
  if (stopSignal?.aborted) {
    throw new StoppedError();
  }

  const combinedSignal = stopSignal ? AbortSignal.any([signal, stopSignal]) : signal;

  try {
    await clock.sleep(ms, combinedSignal);
  } catch (err) {
    if (signal.aborted) {
      throw new ClockCancelledError();
    }
    if (stopSignal?.aborted) {
      throw new StoppedError();
    }
    throw err;
  }

  if (signal.aborted) {
    throw new ClockCancelledError();
  }
  if (stopSignal?.aborted) {
    throw new StoppedError();
  }
}

function loadLimitsSettings(db: Db, worldId: string, fallback?: UsageLimits): UsageLimits | null {
  const row = db.select().from(world_settings).where(eq(world_settings.world_id, worldId)).get();
  if (row) return row;
  return fallback ?? null;
}

function toTemporaryFailureKind(kind: string): TemporaryFailureKind {
  if (kind === "timeout" || kind === "rate_limited") {
    return kind;
  }
  return "server_error";
}

/**
 * LLM の呼び出しを一時的な失敗に対して最大 2 回（30 秒 → 120 秒、合計 3 回まで）再試行する（4章 callWithRetry）。
 * - 1 つの生成イベントの試行は合計 4 回まで。startAttemptNo が 4 を超えていたら呼ばずに TemporaryFailureError。
 * - 失敗した試行はその場で recordAttempt する。
 * - 成功した試行はここでは記録せず、generateAndValidate が出力を検証した後に ok または invalid_format で記録する。
 */
export async function callWithRetry(call: () => Promise<LlmResult>, ctx: RetryContext): Promise<CallWithRetryResult> {
  let attemptNo = ctx.startAttemptNo ?? 1;
  let lastKind: TemporaryFailureKind = ctx.lastFailureKind ?? "server_error";

  if (attemptNo > MAX_EVENT_ATTEMPTS) {
    throw new TemporaryFailureError(lastKind, "Maximum attempts per generation event (4) reached");
  }

  for (let retryIndex = 0; retryIndex <= RETRY_DELAYS_MS.length; retryIndex++) {
    if (ctx.signal.aborted) {
      throw new ClockCancelledError();
    }

    const startedAt = ctx.clock.nowIso();
    const startedMs = ctx.clock.nowMs();
    const usageDate = utcDate(ctx.clock.now());

    try {
      const result = await call();
      if (ctx.signal.aborted) {
        throw new ClockCancelledError();
      }
      return {
        attemptNo,
        startedAt,
        usageDate,
        result,
      };
    } catch (err) {
      const durationMs = Math.max(0, ctx.clock.nowMs() - startedMs);

      if (isCancellation(err, ctx.signal)) {
        recordAttempt(ctx.db, {
          eventId: ctx.eventId,
          attemptNo,
          result: "cancelled",
          durationMs,
          startedAt,
          usageDate,
          isFirstOfEvent: attemptNo === 1,
        });
        if (err instanceof ClockCancelledError || err instanceof LlmCancelledError) {
          throw err;
        }
        throw new ClockCancelledError();
      }

      if (!isLlmError(err)) {
        throw err;
      }

      // プロンプトの全文や API トークンはログに出さない
      ctx.logger.warn("LLM attempt failed", {
        eventId: ctx.eventId,
        attemptNo,
        kind: err.kind,
        httpStatus: err.httpStatus ?? null,
        retryable: err.retryable,
      });

      recordAttempt(ctx.db, {
        eventId: ctx.eventId,
        attemptNo,
        result: err.kind,
        httpStatus: err.httpStatus ?? null,
        errorDetail: err.detail,
        durationMs,
        startedAt,
        usageDate,
        isFirstOfEvent: attemptNo === 1,
      });

      if (err instanceof FreeTierExceededError) {
        throw err;
      }

      lastKind = toTemporaryFailureKind(err.kind);

      if (!err.retryable) {
        throw new TemporaryFailureError(lastKind, err.message, {
          httpStatus: err.httpStatus,
          detail: err.detail,
          cause: err,
        });
      }

      const isLastRetry = retryIndex >= RETRY_DELAYS_MS.length;
      const wouldExceedEventMax = attemptNo >= MAX_EVENT_ATTEMPTS;
      if (isLastRetry || wouldExceedEventMax) {
        throw new TemporaryFailureError(lastKind, err.message, {
          httpStatus: err.httpStatus,
          detail: err.detail,
          cause: err,
        });
      }

      const delayMs = RETRY_DELAYS_MS[retryIndex]!;
      await waitOrStop(delayMs, ctx.signal, ctx.clock, ctx.stopSignal);

      const nowDate = utcDate(ctx.clock.now());
      const settings = loadLimitsSettings(ctx.db, ctx.worldId, ctx.settings);
      const withinLimits = settings ? isWithinLimits(getUsage(ctx.db, nowDate), settings) : true;

      if (!ctx.shouldContinue() || !withinLimits) {
        throw new StoppedError();
      }

      attemptNo += 1;
    }
  }

  throw new TemporaryFailureError(lastKind);
}
