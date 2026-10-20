// P209 投稿の非表示管理の API クライアント（FE 詳細設計 admin_moderation 1章・4章）
import type {
  AgentListQuery,
  AgentListResponse,
  HideRecordPage,
  HideRecordQuery,
  HideRequest,
  Id,
  PostHideResponse,
  PostPage,
  PostSearchQuery,
  PostUnhideResponse,
} from "@nous/shared";
import { adminFetch } from "./client";

function buildQueryString(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      search.set(key, String(value));
    }
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

/** 現在の世界の投稿を検索する（GET /admin/api/posts） */
export function searchPosts(query: PostSearchQuery = {}): Promise<PostPage> {
  const qs = buildQueryString({
    q: query.q,
    visibility: query.visibility,
    agentId: query.agentId,
    postId: query.postId,
    cursor: query.cursor,
    limit: query.limit,
  });
  return adminFetch<PostPage>(`/admin/api/posts${qs}`);
}

/** 投稿を非表示にする（POST /admin/api/posts/:postId/hide） */
export function hidePost(postId: Id, body: HideRequest = {}): Promise<PostHideResponse> {
  return adminFetch<PostHideResponse>(`/admin/api/posts/${encodeURIComponent(postId)}/hide`, {
    method: "POST",
    body,
  });
}

/** 投稿の非表示を取り消す（POST /admin/api/posts/:postId/unhide） */
export function unhidePost(postId: Id, body: HideRequest = {}): Promise<PostUnhideResponse> {
  return adminFetch<PostUnhideResponse>(`/admin/api/posts/${encodeURIComponent(postId)}/unhide`, {
    method: "POST",
    body,
  });
}

/** 非表示と取り消しの履歴を取得する（GET /admin/api/hide-records） */
export function listHideRecords(query: HideRecordQuery = {}): Promise<HideRecordPage> {
  const qs = buildQueryString({
    cursor: query.cursor,
    limit: query.limit,
  });
  return adminFetch<HideRecordPage>(`/admin/api/hide-records${qs}`);
}

/** エージェントの絞り込み選択肢用にエージェント一覧を取得する（GET /admin/api/agents） */
export function listAgents(query: AgentListQuery = {}): Promise<AgentListResponse> {
  const qs = buildQueryString({
    state: query.state,
  });
  return adminFetch<AgentListResponse>(`/admin/api/agents${qs}`);
}
