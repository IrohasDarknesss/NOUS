// P211 世界のアーカイブの API クライアント（FE 詳細設計 admin_moderation 1章・4章）
import type { Id, WorldGenerationsResponse, WorldListResponse, WorldPageQuery, WorldPostsResponse } from "@nous/shared";
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

/** 世界の一覧を取得する（GET /admin/api/worlds） */
export function listWorlds(): Promise<WorldListResponse> {
  return adminFetch<WorldListResponse>("/admin/api/worlds");
}

/** 指定した世界の投稿一覧を取得する（GET /admin/api/worlds/:worldId/posts） */
export function getArchivePosts(worldId: Id, query: WorldPageQuery = {}): Promise<WorldPostsResponse> {
  const qs = buildQueryString({
    cursor: query.cursor,
    limit: query.limit,
  });
  return adminFetch<WorldPostsResponse>(`/admin/api/worlds/${encodeURIComponent(worldId)}/posts${qs}`);
}

/** 指定した世界の生成イベント一覧を取得する（GET /admin/api/worlds/:worldId/generations） */
export function getArchiveGenerations(worldId: Id, query: WorldPageQuery = {}): Promise<WorldGenerationsResponse> {
  const qs = buildQueryString({
    cursor: query.cursor,
    limit: query.limit,
  });
  return adminFetch<WorldGenerationsResponse>(`/admin/api/worlds/${encodeURIComponent(worldId)}/generations${qs}`);
}
