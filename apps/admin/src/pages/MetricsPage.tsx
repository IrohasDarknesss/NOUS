// P206 利用量・運用指標（FE 詳細設計 admin_agents_logs 2章・3章・4章、画面基本設計書 P206）
import { FREE_TIER_NEURONS, METRICS_DEFAULT_DAYS, type MetricsView } from "@nous/shared";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ApiError, NetworkError } from "../api/client";
import { getDailyMetrics, metricsQueryKey } from "../api/metrics";
import { useErrorState } from "../shared/ErrorContext";
import { fontSizes } from "../shared/theme";
import { useApiErrorHandler } from "../shared/useApiErrorHandler";
import { ActivityChart } from "./metrics/ActivityChart";
import { DateRangePicker, presetRange, todayUtcDate, validateRange } from "./metrics/DateRangePicker";
import { MetricsTable, openFailedLogs } from "./metrics/MetricsTable";
import { TodaySummary } from "./metrics/TodaySummary";
import { UsageChart } from "./metrics/UsageChart";

export const METRICS_REFETCH_MS = 30_000;
export const METRICS_FAILURE_LIMIT = 3;
export const METRICS_FETCH_FAILED_MESSAGE = "最新の指標を取得できていません";
export const METRICS_INITIAL_ERROR_MESSAGE = "指標を取得できませんでした。時間をおいて再度お試しください";

export function useMetrics(range: { from: string; to: string }): {
  data: MetricsView | undefined;
  isLoading: boolean;
  isError: boolean;
} {
  const isToday = range.to === todayUtcDate();
  const query = useQuery({
    queryKey: metricsQueryKey(range.from, range.to),
    queryFn: () => getDailyMetrics(range),
    refetchInterval: isToday ? METRICS_REFETCH_MS : false,
    retry: false,
  });

  const { showBanner, clearBanner, showModal } = useErrorState();
  const handleApiError = useApiErrorHandler();
  const failures = useRef(0);
  const hadSuccess = useRef(false);

  useEffect(() => {
    failures.current = 0;
    hadSuccess.current = false;
  }, [range.from, range.to]);

  useEffect(() => {
    if (query.isSuccess) {
      if (failures.current >= METRICS_FAILURE_LIMIT) clearBanner();
      failures.current = 0;
      hadSuccess.current = true;
      return;
    }
    if (query.isError && query.error) {
      if (query.error instanceof ApiError && query.error.status === 401) {
        handleApiError(query.error);
        return;
      }
      if (hadSuccess.current) {
        failures.current += 1;
        if (failures.current === METRICS_FAILURE_LIMIT) showBanner(METRICS_FETCH_FAILED_MESSAGE);
      } else {
        if ((query.error instanceof ApiError && query.error.status >= 500) || query.error instanceof NetworkError) {
          showModal({ message: METRICS_INITIAL_ERROR_MESSAGE });
        } else {
          handleApiError(query.error);
        }
      }
    }
  }, [
    query.isError,
    query.isSuccess,
    query.error,
    query.errorUpdatedAt,
    query.dataUpdatedAt,
    showBanner,
    clearBanner,
    showModal,
    handleApiError,
  ]);

  return { data: query.data, isLoading: query.isLoading, isError: query.isError };
}

export function MetricsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const defaultRange = presetRange(METRICS_DEFAULT_DAYS);
  const paramFrom = searchParams.get("from");
  const paramTo = searchParams.get("to");
  const hasValidParams = Boolean(paramFrom && paramTo && !validateRange(paramFrom, paramTo));
  const range = hasValidParams ? { from: paramFrom!, to: paramTo! } : defaultRange;

  const { data } = useMetrics(range);

  const items = data?.items ?? [];
  const freeTier = data?.freeTierNeurons ?? FREE_TIER_NEURONS;
  const limit = data?.neuronsLimit;
  const todayStr = todayUtcDate();
  const todayItem = items.find((item) => item.usageDate === todayStr) ?? items[items.length - 1] ?? null;

  const handleRangeChange = (next: { from: string; to: string }) => {
    setSearchParams({ from: next.from, to: next.to }, { replace: true });
  };

  return (
    <section aria-label="P206">
      <h1 style={{ fontSize: fontSizes.heading, margin: "0 0 16px" }}>利用量・運用指標（P206）</h1>
      <DateRangePicker from={range.from} to={range.to} onChange={handleRangeChange} />
      <TodaySummary today={todayItem} freeTier={freeTier} />
      <UsageChart items={items} freeTier={freeTier} limit={limit} />
      <ActivityChart items={items} />
      <MetricsTable items={items} onErrorRateClick={(usageDate) => openFailedLogs(usageDate, navigate)} />
    </section>
  );
}
