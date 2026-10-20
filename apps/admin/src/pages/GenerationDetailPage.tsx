// P208 生成ログ詳細（FE 詳細設計 admin_agents_logs 2章・3章・4章・6章、画面基本設計書 P208）
import type { GenerationDetail } from "@nous/shared";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError, NetworkError } from "../api/client";
import { generationDetailQueryKey, getGeneration } from "../api/generations";
import { useErrorState } from "../shared/ErrorContext";
import { colors, fontSizes } from "../shared/theme";
import { useApiErrorHandler } from "../shared/useApiErrorHandler";
import { AttemptTable } from "./generations/AttemptTable";
import { ConsistencyFlags } from "./generations/ConsistencyFlags";
import { EventSummary } from "./generations/EventSummary";
import { InputSection } from "./generations/InputSection";
import { PromptViewer } from "./generations/PromptViewer";
import { ResultPostCard } from "./generations/ResultPostCard";

export const GENERATION_DETAIL_ERROR_MESSAGE = "生成ログを取得できませんでした";

export function useGeneration(eventId: string): {
  data: GenerationDetail | undefined;
  isLoading: boolean;
  isNotFound: boolean;
} {
  const query = useQuery({
    queryKey: generationDetailQueryKey(eventId),
    queryFn: () => getGeneration(eventId),
    enabled: Boolean(eventId),
    retry: false,
  });

  const handleApiError = useApiErrorHandler();
  const { showModal } = useErrorState();
  const isNotFound =
    query.isError &&
    query.error instanceof ApiError &&
    (query.error.status === 404 || query.error.code === "EVENT_NOT_FOUND");

  useEffect(() => {
    if (!query.isError || !query.error || isNotFound) return;
    if ((query.error instanceof ApiError && query.error.status >= 500) || query.error instanceof NetworkError) {
      showModal({ message: GENERATION_DETAIL_ERROR_MESSAGE });
    } else {
      handleApiError(query.error);
    }
  }, [query.isError, query.error, query.errorUpdatedAt, isNotFound, handleApiError, showModal]);

  return { data: query.data, isLoading: query.isLoading, isNotFound };
}

export function GenerationDetailPage() {
  const { eventId = "" } = useParams<{ eventId: string }>();
  const { data, isNotFound } = useGeneration(eventId);

  if (isNotFound) {
    return (
      <section
        aria-label="P208"
        style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 6,
          padding: 24,
        }}
      >
        <h1 style={{ fontSize: fontSizes.heading, margin: "0 0 12px" }}>生成ログ詳細（P208）</h1>
        <p role="alert" style={{ margin: "0 0 16px" }}>
          生成イベントが見つかりません
        </p>
        <Link to="/generations" style={{ color: colors.primary }}>
          生成ログ一覧へ戻る
        </Link>
      </section>
    );
  }

  return (
    <section aria-label="P208">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <h1 style={{ fontSize: fontSizes.heading, margin: 0 }}>生成ログ詳細（P208）</h1>
        <Link to="/generations" style={{ color: colors.primary }}>
          ← 一覧へ戻る
        </Link>
      </div>
      {data && (
        <>
          <EventSummary event={data.event} />
          <InputSection event={data.event} refPosts={data.refPosts} />
          <PromptViewer promptText={data.event.promptText} outputText={data.event.outputText} />
          <AttemptTable attempts={data.attempts} />
          <ConsistencyFlags flags={data.event.consistencyFlags} />
          <ResultPostCard post={data.resultPost} />
        </>
      )}
    </section>
  );
}
