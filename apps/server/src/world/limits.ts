// 上限の判定（BE 詳細設計 world 4章 isWithinLimits・limitReason、基本設計書 概要 6章）
// 既定の上限は Neurons 9,500・実行回数 480 回（world_settings の既定値）

/** 利用日の利用量（daily_usage の一部） */
export interface DailyUsage {
  neurons: number;
  runs: number;
}

/** 上限の設定（world_settings の一部） */
export interface UsageLimits {
  daily_neurons_limit: number;
  daily_runs_limit: number;
}

export type LimitReason = "neurons_limit" | "runs_limit";

/** neurons < 日次上限 かつ runs < 日次上限 なら true */
export function isWithinLimits(usage: DailyUsage, settings: UsageLimits): boolean {
  return usage.neurons < settings.daily_neurons_limit && usage.runs < settings.daily_runs_limit;
}

/** 上限に達した理由。Neurons を先に見る。どちらも上限の中なら null */
export function limitReason(usage: DailyUsage, settings: UsageLimits): LimitReason | null {
  if (usage.neurons >= settings.daily_neurons_limit) return "neurons_limit";
  if (usage.runs >= settings.daily_runs_limit) return "runs_limit";
  return null;
}
