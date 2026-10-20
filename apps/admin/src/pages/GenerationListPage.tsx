// P207 生成ログ一覧（FE 詳細設計 admin_agents_logs 2章・3章・4章、画面基本設計書 P207）
import { ACTIONS, GENERATION_STATUSES, type Action, type GenerationStatus } from "@nous/shared";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ApiError, NetworkError } from "../api/client";
import {
  agentOptionsQueryKey,
  generationsQueryKey,
  listAgentOptions,
  listGenerations,
  type GenerationFiltersValue,
} from "../api/generations";
import { useErrorState } from "../shared/ErrorContext";
import { buttonStyle } from "../shared/Modal";
import { fontSizes } from "../shared/theme";
import { useApiErrorHandler } from "../shared/useApiErrorHandler";
import { GenerationFilters, searchByEventId } from "./generations/GenerationFilters";
import { GenerationTable } from "./generations/GenerationTable";

export const GENERATIONS_ERROR_MESSAGE = "生成ログを取得できませんでした。時間をおいて再度お試しください";

export function parseGenerationFilters(searchParams: URLSearchParams): GenerationFiltersValue {
  const agentId = searchParams.get("agentId") || undefined;
  const actionParam = searchParams.get("action");
  const action =
    actionParam && (ACTIONS as readonly string[]).includes(actionParam) ? (actionParam as Action) : undefined;
  const statusParam = searchParams.get("status");
  const status =
    statusParam && (GENERATION_STATUSES as readonly string[]).includes(statusParam)
      ? (statusParam as GenerationStatus)
      : undefined;
  const from = searchParams.get("from") || undefined;
  const to = searchParams.get("to") || undefined;
  return { agentId, action, status, from, to };
}

export function buildGenerationSearchParams(filters: GenerationFiltersValue): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.agentId) params.set("agentId", filters.agentId);
  if (filters.action) params.set("action", filters.action);
  if (filters.status) params.set("status", filters.status);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  return params;
}

export function useGenerationFilters() {
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => parseGenerationFilters(searchParams), [searchParams]);

  const setFilters = useCallback(
    (next: GenerationFiltersValue) => {
      setSearchParams(buildGenerationSearchParams(next), { replace: true });
    },
    [setSearchParams],
  );

  return { filters, setFilters };
}

export function useGenerations(filters: GenerationFiltersValue) {
  const query = useInfiniteQuery({
    queryKey: generationsQueryKey(filters),
    queryFn: ({ pageParam }) => listGenerations(filters, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    retry: false,
  });

  const handleApiError = useApiErrorHandler();
  const { showModal } = useErrorState();

  useEffect(() => {
    if (query.isError && query.error) {
      if ((query.error instanceof ApiError && query.error.status >= 500) || query.error instanceof NetworkError) {
        showModal({ message: GENERATIONS_ERROR_MESSAGE });
      } else {
        handleApiError(query.error);
      }
    }
  }, [query.isError, query.error, query.errorUpdatedAt, handleApiError, showModal]);

  return query;
}

export function GenerationListPage() {
  const navigate = useNavigate();
  const { filters, setFilters } = useGenerationFilters();
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage } = useGenerations(filters);

  const agentsQuery = useQuery({
    queryKey: agentOptionsQueryKey(),
    queryFn: listAgentOptions,
    retry: false,
  });

  const items = useMemo(() => data?.pages.flatMap((p) => p.items) ?? [], [data]);
  const agents = agentsQuery.data?.items ?? [];

  return (
    <section aria-label="P207">
      <h1 style={{ fontSize: fontSizes.heading, margin: "0 0 16px" }}>生成ログ一覧（P207）</h1>
      <GenerationFilters
        filters={filters}
        agents={agents}
        onChange={setFilters}
        onSearchId={(input) => searchByEventId(input, navigate)}
      />
      <GenerationTable items={items} onRowClick={(item) => navigate(`/generations/${item.eventId}`)} />
      {hasNextPage && (
        <div style={{ marginTop: 16, textAlign: "center" }}>
          <button type="button" disabled={isFetchingNextPage} onClick={() => void fetchNextPage()} style={buttonStyle}>
            {isFetchingNextPage ? "読み込み中…" : "さらに読み込む"}
          </button>
        </div>
      )}
    </section>
  );
}
