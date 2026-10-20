// P206 利用量・運用指標の API（FE 詳細設計 admin_agents_logs 1章・4章）
import type { MetricsQuery, MetricsView } from "@nous/shared";
import { adminFetch } from "./client";

export function metricsQueryKey(from: string, to: string) {
  return ["admin", "metrics", from, to] as const;
}

export function getDailyMetrics({ from, to }: MetricsQuery): Promise<MetricsView> {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const qs = params.toString();
  return adminFetch<MetricsView>(`/admin/api/metrics/daily${qs ? `?${qs}` : ""}`);
}
