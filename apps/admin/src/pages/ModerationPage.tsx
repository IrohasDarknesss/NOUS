// P209 投稿の非表示管理（FE 詳細設計 admin_moderation 2章〜6章）
import type { AdminPostItem, Visibility } from "@nous/shared";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ApiError } from "../api/client";
import { hidePost, listAgents, listHideRecords, searchPosts, unhidePost } from "../api/moderation";
import { colors, fontSizes } from "../shared/theme";
import { useToast } from "../shared/Toast";
import { useApiErrorHandler, type FieldErrors } from "../shared/useApiErrorHandler";
import { HideHistoryTable } from "./moderation/HideHistoryTable";
import { HideReasonDialog } from "./moderation/HideReasonDialog";
import { ModerationTabs, type ModerationTab } from "./moderation/ModerationTabs";
import { PostModerationTable } from "./moderation/PostModerationTable";
import { PostSearchForm, type SearchQuery } from "./moderation/PostSearchForm";

export const HIDE_CONFLICT_MESSAGE = "投稿の状態が変わったため、操作できませんでした。一覧を更新します";
export const HIDE_SUCCESS_TOAST = "非表示にしました。観察画面から見えなくなります";
export const UNHIDE_SUCCESS_TOAST = "非表示を取り消しました";

export interface ModerationParams {
  tab: ModerationTab;
  postId?: string;
  q?: string;
  visibility?: Visibility;
  agentId?: string;
}

export function useModerationParams() {
  const [searchParams, setSearchParams] = useSearchParams();

  const params = useMemo<ModerationParams>(() => {
    const rawTab = searchParams.get("tab");
    const tab: ModerationTab = rawTab === "history" ? "history" : "search";
    const postId = searchParams.get("postId") || undefined;
    const q = searchParams.get("q") || undefined;
    const rawVis = searchParams.get("visibility");
    const visibility: Visibility | undefined = rawVis === "public" || rawVis === "hidden" ? rawVis : undefined;
    const agentId = searchParams.get("agentId") || undefined;
    return { tab, postId, q, visibility, agentId };
  }, [searchParams]);

  const setParams = useCallback(
    (next: Partial<ModerationParams>) => {
      setSearchParams(
        (prev) => {
          const updated = new URLSearchParams(prev);
          const merged: ModerationParams = {
            tab: next.tab ?? (prev.get("tab") === "history" ? "history" : "search"),
            postId: "postId" in next ? next.postId : prev.get("postId") || undefined,
            q: "q" in next ? next.q : prev.get("q") || undefined,
            visibility:
              "visibility" in next ? next.visibility : ((prev.get("visibility") as Visibility | null) ?? undefined),
            agentId: "agentId" in next ? next.agentId : prev.get("agentId") || undefined,
          };

          if (merged.tab === "history") updated.set("tab", "history");
          else updated.delete("tab");

          if (merged.postId) updated.set("postId", merged.postId);
          else updated.delete("postId");

          if (merged.q) updated.set("q", merged.q);
          else updated.delete("q");

          if (merged.visibility) updated.set("visibility", merged.visibility);
          else updated.delete("visibility");

          if (merged.agentId) updated.set("agentId", merged.agentId);
          else updated.delete("agentId");

          return updated;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  return { params, setParams };
}

export function usePostSearch(query: SearchQuery) {
  const effectiveQuery: SearchQuery = useMemo(
    () =>
      query.postId
        ? { postId: query.postId }
        : {
            q: query.q,
            visibility: query.visibility,
            agentId: query.agentId,
          },
    [query.postId, query.q, query.visibility, query.agentId],
  );

  return useInfiniteQuery({
    queryKey: ["admin", "posts", effectiveQuery] as const,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => searchPosts({ ...effectiveQuery, cursor: pageParam }),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}

export function useHideRecords(enabled: boolean) {
  return useInfiniteQuery({
    queryKey: ["admin", "hideRecords"] as const,
    enabled,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => listHideRecords({ cursor: pageParam }),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}

export function ModerationPage() {
  const { params, setParams } = useModerationParams();
  const [dialog, setDialog] = useState<{ mode: "hide" | "unhide"; post: AdminPostItem } | null>(null);
  const [searchFieldError, setSearchFieldError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const handleApiError = useApiErrorHandler();
  const navigate = useNavigate();

  const searchQuery = useMemo<SearchQuery>(
    () => ({
      postId: params.postId,
      q: params.q,
      visibility: params.visibility,
      agentId: params.agentId,
    }),
    [params.postId, params.q, params.visibility, params.agentId],
  );

  const postsQuery = usePostSearch(searchQuery);
  const hideRecordsQuery = useHideRecords(params.tab === "history");
  const agentsQuery = useQuery({
    queryKey: ["admin", "agents"] as const,
    queryFn: () => listAgents(),
  });

  useEffect(() => {
    const err = postsQuery.error;
    if (!err) return;
    const fields = handleApiError(err);
    if (fields) setSearchFieldError(fields.q ?? fields._form ?? null);
  }, [postsQuery.error, handleApiError]);

  useEffect(() => {
    const err = hideRecordsQuery.error;
    if (err) handleApiError(err);
  }, [hideRecordsQuery.error, handleApiError]);

  const posts = useMemo(() => postsQuery.data?.pages.flatMap((p) => p.items) ?? [], [postsQuery.data]);

  const hideRecords = useMemo(
    () => hideRecordsQuery.data?.pages.flatMap((p) => p.items) ?? [],
    [hideRecordsQuery.data],
  );

  const agents = useMemo(() => agentsQuery.data?.items ?? [], [agentsQuery.data]);

  const openHideDialog = (post: AdminPostItem, mode: "hide" | "unhide") => {
    setDialog({ mode, post });
  };

  const handleConfirmHide = async (reason?: string): Promise<FieldErrors | void> => {
    if (!dialog) return;
    const { mode, post } = dialog;
    const body = reason !== undefined ? { reason } : {};
    try {
      if (mode === "hide") {
        await hidePost(post.postId, body);
      } else {
        await unhidePost(post.postId, body);
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin", "posts"] }),
        queryClient.invalidateQueries({ queryKey: ["admin", "hideRecords"] }),
      ]);
      showToast(mode === "hide" ? HIDE_SUCCESS_TOAST : UNHIDE_SUCCESS_TOAST);
      setDialog(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        return handleApiError(err);
      }
      handleApiError(err, {
        conflictMessage: HIDE_CONFLICT_MESSAGE,
        invalidateKeys: [
          ["admin", "posts"],
          ["admin", "hideRecords"],
        ],
      });
      setDialog(null);
    }
  };

  return (
    <section>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 16 }}>
        <h1 style={{ fontSize: fontSizes.heading, margin: 0 }}>投稿の非表示管理</h1>
        <span style={{ color: colors.subText, fontSize: 12 }}>P209</span>
      </div>

      <ModerationTabs
        tab={params.tab}
        onChange={(nextTab) => {
          setSearchFieldError(null);
          setParams({ tab: nextTab });
        }}
      />

      {params.tab === "search" ? (
        <>
          <PostSearchForm
            query={searchQuery}
            agents={agents}
            fieldError={searchFieldError}
            onSearch={(next) => {
              setSearchFieldError(null);
              setParams({
                postId: undefined,
                q: next.q,
                visibility: next.visibility,
                agentId: next.agentId,
              });
            }}
          />
          <PostModerationTable
            items={posts}
            onHide={(post) => openHideDialog(post, "hide")}
            onUnhide={(post) => openHideDialog(post, "unhide")}
            onOpenLog={(post) => {
              if (post.generationEventId) {
                navigate(`/generations/${encodeURIComponent(post.generationEventId)}`);
              }
            }}
            onLoadMore={postsQuery.hasNextPage ? () => void postsQuery.fetchNextPage() : undefined}
            loadingMore={postsQuery.isFetchingNextPage}
          />
        </>
      ) : (
        <HideHistoryTable
          items={hideRecords}
          onLoadMore={hideRecordsQuery.hasNextPage ? () => void hideRecordsQuery.fetchNextPage() : undefined}
          loadingMore={hideRecordsQuery.isFetchingNextPage}
        />
      )}

      {dialog && (
        <HideReasonDialog
          mode={dialog.mode}
          post={dialog.post}
          onConfirm={handleConfirmHide}
          onCancel={() => setDialog(null)}
        />
      )}
    </section>
  );
}
