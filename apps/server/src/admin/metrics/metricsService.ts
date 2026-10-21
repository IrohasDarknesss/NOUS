// 日別の指標の集計と参照（BE 詳細設計 admin_data 2章・3章・4章、NOUS-65）
// 読み取りだけ：DB を書き換えない。
import {
  DEFAULT_SETTINGS,
  FREE_TIER_NEURONS,
  METRICS_DEFAULT_DAYS,
  MetricsQuerySchema,
  type DailyMetricsItem,
  type MetricsQuery,
  type MetricsResponse,
} from "@nous/shared";
import { and, gte, lte, eq } from "drizzle-orm";
import type { Clock } from "../../clock/clock";
import { utcDate } from "../../clock/clock";
import { daily_metrics, daily_usage } from "../../db/schema";
import type { DbOrTx } from "../../db/tx";
import { AppError } from "../../lib/errors";
import { findCurrentWorld, findWorldSettings } from "../../world/worldService";
import { zodFields } from "../middleware/errorHandler";

const DAY_MS = 86_400_000;

/** getDailyMetrics の出力・computeRates の入力（snake_case） */
export interface DailyRow {
  usage_date: string;
  calls: number;
  runs: number;
  prompt_tokens: number;
  completion_tokens: number;
  neurons: number;
  posts: number;
  replies: number;
  replied_posts: number;
  likes: number;
  follows: number;
  nones: number;
  failures: number;
}

/**
 * 4章 dateRange：from から to まで1日ずつの YYYY-MM-DD の配列（UTC 基準）
 */
export function dateRange(from: string, to: string): string[] {
  const result: string[] = [];
  const [fY, fM, fD] = from.split("-").map(Number);
  const [tY, tM, tD] = to.split("-").map(Number);
  if (
    fY === undefined ||
    fM === undefined ||
    fD === undefined ||
    tY === undefined ||
    tM === undefined ||
    tD === undefined
  ) {
    return [];
  }
  let current = Date.UTC(fY, fM - 1, fD);
  const end = Date.UTC(tY, tM - 1, tD);
  while (current <= end) {
    result.push(new Date(current).toISOString().slice(0, 10));
    current += DAY_MS;
  }
  return result;
}

/**
 * 4章 computeRates：replyRate・errorRate・actions を計算（分母 0 は null、costJpy は 0）
 */
export function computeRates(row: DailyRow): DailyMetricsItem {
  return {
    usageDate: row.usage_date,
    calls: row.calls,
    runs: row.runs,
    promptTokens: row.prompt_tokens,
    completionTokens: row.completion_tokens,
    neurons: row.neurons,
    costJpy: 0,
    posts: row.posts,
    replies: row.replies,
    replyRate: row.posts === 0 ? null : row.replied_posts / row.posts,
    likes: row.likes,
    follows: row.follows,
    nones: row.nones,
    actions: row.posts + row.replies + row.likes + row.follows,
    failures: row.failures,
    errorRate: row.runs === 0 ? null : row.failures / row.runs,
  };
}

/**
 * 3章 getDailyMetrics：daily_usage（アカウント単位）と、現在の世界の daily_metrics を日付で突き合わせる（データのない日は 0）
 */
export function getDailyMetrics(db: DbOrTx, worldId: string | undefined, dates: string[]): DailyRow[] {
  if (dates.length === 0) return [];
  const minDate = dates[0]!;
  const maxDate = dates[dates.length - 1]!;

  const usageRows = db
    .select()
    .from(daily_usage)
    .where(and(gte(daily_usage.usage_date, minDate), lte(daily_usage.usage_date, maxDate)))
    .all();
  const usageMap = new Map(usageRows.map((r) => [r.usage_date, r]));

  const metricsMap = new Map<string, typeof daily_metrics.$inferSelect>();
  if (worldId !== undefined) {
    const metricsRows = db
      .select()
      .from(daily_metrics)
      .where(
        and(
          eq(daily_metrics.world_id, worldId),
          gte(daily_metrics.usage_date, minDate),
          lte(daily_metrics.usage_date, maxDate),
        ),
      )
      .all();
    for (const r of metricsRows) {
      metricsMap.set(r.usage_date, r);
    }
  }

  return dates.map((date) => {
    const u = usageMap.get(date);
    const m = metricsMap.get(date);
    return {
      usage_date: date,
      calls: u?.calls ?? 0,
      runs: u?.runs ?? 0,
      prompt_tokens: u?.prompt_tokens ?? 0,
      completion_tokens: u?.completion_tokens ?? 0,
      neurons: u?.neurons ?? 0,
      posts: m?.posts ?? 0,
      replies: m?.replies ?? 0,
      replied_posts: m?.replied_posts ?? 0,
      likes: m?.likes ?? 0,
      follows: m?.follows ?? 0,
      nones: m?.nones ?? 0,
      failures: m?.failures ?? 0,
    };
  });
}

/**
 * 4章 getDailyMetricsView：既定の期間（今日を含む直近 14 日）を埋め、検証（from ≦ to、90 日以内）し、
 * getDailyMetrics と computeRates で MetricsView を返す
 */
export function getDailyMetricsView(db: DbOrTx, clock: Clock, query: MetricsQuery = {}): MetricsResponse {
  const now = clock.now();
  const today = utcDate(now);
  const defaultFrom = utcDate(new Date(now.getTime() - (METRICS_DEFAULT_DAYS - 1) * DAY_MS));

  const rawFrom = query.from ?? defaultFrom;
  const rawTo = query.to ?? today;

  const parsed = MetricsQuerySchema.safeParse({ from: rawFrom, to: rawTo });
  if (!parsed.success) {
    throw new AppError("VALIDATION_ERROR", { fields: zodFields(parsed.error) });
  }

  const { from, to } = parsed.data;
  // safeParse を通過していれば from, to は実在する日付かつ from ≦ to, 90 日以内
  const dates = dateRange(from!, to!);

  const world = findCurrentWorld(db);
  const settings = world ? findWorldSettings(db, world.world_id) : undefined;
  const neuronsLimit = settings?.daily_neurons_limit ?? DEFAULT_SETTINGS.dailyNeuronsLimit;
  const freeTierNeurons = FREE_TIER_NEURONS;

  const dailyRows = getDailyMetrics(db, world?.world_id, dates);
  const items = dailyRows.map(computeRates);

  return {
    freeTierNeurons,
    neuronsLimit,
    items,
  };
}
