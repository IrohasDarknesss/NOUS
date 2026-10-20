// 試行の記録と daily_usage・daily_metrics の加算（BE 詳細設計 generation 3章・4章 recordAttempt・addDailyUsage・addDailyMetrics、
// 行動生成とプロンプトの設計 3章・7章、基本設計書 概要 6章 daily_usage・daily_metrics）。
import { eq, sql, type SQL } from "drizzle-orm";
import type { ActionKind } from "../config/generationConfig";
import type { Db } from "../db/client";
import { ATTEMPT_RESULTS, daily_metrics, daily_usage, generation_attempts, generation_events } from "../db/schema";
import { withTx, type DbOrTx } from "../db/tx";
import { newUlid } from "../lib/ids";

export type AttemptResult = (typeof ATTEMPT_RESULTS)[number];

/** error_detail の上限（generation_attempts.error_detail の CHECK と同じ 500 字） */
export const MAX_ERROR_DETAIL_CHARS = 500;

export const METRIC_COLUMNS = [
  "runs",
  "posts",
  "replies",
  "replied_posts",
  "likes",
  "follows",
  "nones",
  "failures",
] as const;

export type MetricColumn = (typeof METRIC_COLUMNS)[number];
export type DailyMetricsDelta = Partial<Record<MetricColumn, number>>;

export type DailyUsageInput = {
  /** その生成イベントで最初の LLM の呼び出しのとき true（runs を +1 する） */
  isFirstOfEvent?: boolean;
  /** runs の加算値を直接渡すとき（省略時は isFirstOfEvent ? 1 : 0） */
  runs?: number;
  promptTokens?: number;
  completionTokens?: number;
  neurons?: number;
};

export type RecordAttemptInput = {
  eventId: string;
  attemptNo: number;
  result: AttemptResult;
  httpStatus?: number | null;
  errorDetail?: string | null;
  promptTokens?: number;
  completionTokens?: number;
  neurons?: number;
  durationMs: number;
  startedAt: string;
  usageDate: string;
  /** その生成イベントで最初の LLM の呼び出しのとき true。省略時は attemptNo === 1 */
  isFirstOfEvent?: boolean;
};

/** コードポイントで数えて 500 字までにする */
export function clipErrorDetail(detail: string | null | undefined): string | null {
  if (detail == null) return null;
  const chars = [...detail];
  return chars.length <= MAX_ERROR_DETAIL_CHARS ? detail : chars.slice(0, MAX_ERROR_DETAIL_CHARS).join("");
}

/**
 * daily_usage に 1 回分の呼び出しを加算する（3章 addDailyUsage）。
 * runs は最初の試行（isFirstOfEvent=true）のとき 1、再試行・再生成のとき 0 にする。
 */
export function addDailyUsage(tx: DbOrTx, usageDate: string, input: DailyUsageInput = {}): void {
  const runs = input.runs ?? (input.isFirstOfEvent ? 1 : 0);
  const promptTokens = input.promptTokens ?? 0;
  const completionTokens = input.completionTokens ?? 0;
  const neurons = input.neurons ?? 0;

  tx.insert(daily_usage)
    .values({
      usage_date: usageDate,
      calls: 1,
      runs,
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      neurons,
    })
    .onConflictDoUpdate({
      target: daily_usage.usage_date,
      set: {
        calls: sql`${daily_usage.calls} + 1`,
        runs: sql`${daily_usage.runs} + ${runs}`,
        prompt_tokens: sql`${daily_usage.prompt_tokens} + ${promptTokens}`,
        completion_tokens: sql`${daily_usage.completion_tokens} + ${completionTokens}`,
        neurons: sql`${daily_usage.neurons} + ${neurons}`,
      },
    })
    .run();
}

/**
 * daily_metrics に渡された列だけを加算する（3章 addDailyMetrics）。
 */
export function addDailyMetrics(tx: DbOrTx, worldId: string, usageDate: string, delta: DailyMetricsDelta): void {
  const values: typeof daily_metrics.$inferInsert = {
    world_id: worldId,
    usage_date: usageDate,
  };
  const set: Partial<Record<MetricColumn, SQL>> = {};

  for (const col of METRIC_COLUMNS) {
    const val = delta[col];
    if (val !== undefined) {
      values[col] = val;
      set[col] = sql`${daily_metrics[col]} + ${val}`;
    }
  }

  if (Object.keys(set).length === 0) {
    tx.insert(daily_metrics).values(values).onConflictDoNothing().run();
    return;
  }

  tx.insert(daily_metrics)
    .values(values)
    .onConflictDoUpdate({
      target: [daily_metrics.world_id, daily_metrics.usage_date],
      set,
    })
    .run();
}

/**
 * LLM による生成が成功したときに daily_metrics へ加算する値を返す。
 * replied_posts は applyAction の中で加算済みなので、ここでは足さない。
 */
export function metricsForSucceededAction(action: ActionKind | "none"): DailyMetricsDelta {
  switch (action) {
    case "post":
      return { runs: 1, posts: 1 };
    case "reply":
      return { runs: 1, posts: 1, replies: 1 };
    case "like":
      return { runs: 1, likes: 1 };
    case "follow":
    case "unfollow":
      return { runs: 1, follows: 1 };
    case "none":
      return { runs: 1, nones: 1 };
  }
}

/**
 * 1 回の試行を 1 トランザクションで記録する（4章 recordAttempt）。
 * 1. generation_attempts に INSERT（トークン・neurons は成功（result=ok）のときだけ）
 * 2. addDailyUsage（calls+1、runs は isFirstOfEvent のとき +1、トークン、neurons）
 * 3. generation_events の prompt_tokens・completion_tokens・neurons に加算
 */
export function recordAttempt(db: Db, input: RecordAttemptInput): string {
  const attemptId = newUlid();
  const isOk = input.result === "ok";
  const promptTokens = isOk ? (input.promptTokens ?? 0) : 0;
  const completionTokens = isOk ? (input.completionTokens ?? 0) : 0;
  const neurons = isOk ? (input.neurons ?? 0) : 0;
  const isFirstOfEvent = input.isFirstOfEvent ?? input.attemptNo === 1;
  const errorDetail = clipErrorDetail(input.errorDetail);
  const durationMs = Math.max(0, Math.floor(input.durationMs));

  withTx(db, (tx) => {
    tx.insert(generation_attempts)
      .values({
        attempt_id: attemptId,
        event_id: input.eventId,
        attempt_no: input.attemptNo,
        result: input.result,
        http_status: input.httpStatus ?? null,
        error_detail: errorDetail,
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        neurons,
        duration_ms: durationMs,
        started_at: input.startedAt,
      })
      .run();

    addDailyUsage(tx, input.usageDate, {
      isFirstOfEvent,
      promptTokens,
      completionTokens,
      neurons,
    });

    tx.update(generation_events)
      .set({
        prompt_tokens: sql`${generation_events.prompt_tokens} + ${promptTokens}`,
        completion_tokens: sql`${generation_events.completion_tokens} + ${completionTokens}`,
        neurons: sql`${generation_events.neurons} + ${neurons}`,
      })
      .where(eq(generation_events.event_id, input.eventId))
      .run();
  });

  return attemptId;
}
