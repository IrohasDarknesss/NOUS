// 観察 API の呼び出し関数（FE 詳細設計 observer 4章）
import { fetchJson } from "./client";
import type {
  AgentPostsQuery,
  AgentPostsResponse,
  AgentProfileView,
  FollowsResponse,
  FollowType,
  ThreadQuery,
  ThreadView,
  TimelinePage,
  TimelineQuery,
  WorldView,
} from "./types";

type QueryValue = string | number | undefined;

/** 値が undefined の項目は付けない */
export function withQuery(path: string, query: Record<string, QueryValue>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

export function getWorld(): Promise<WorldView> {
  return fetchJson<WorldView>("/api/world");
}

export function getTimeline(query: TimelineQuery = {}): Promise<TimelinePage> {
  return fetchJson<TimelinePage>(
    withQuery("/api/timeline", { cursor: query.cursor, limit: query.limit, since: query.since }),
  );
}

export function getThread(postId: string, query: ThreadQuery = {}): Promise<ThreadView> {
  return fetchJson<ThreadView>(
    withQuery(`/api/posts/${encodeURIComponent(postId)}/thread`, { depth: query.depth, from: query.from }),
  );
}

export function getAgentProfile(agentId: string): Promise<AgentProfileView> {
  return fetchJson<AgentProfileView>(`/api/agents/${encodeURIComponent(agentId)}`);
}

export function getAgentPosts(agentId: string, query: AgentPostsQuery = {}): Promise<AgentPostsResponse> {
  return fetchJson<AgentPostsResponse>(
    withQuery(`/api/agents/${encodeURIComponent(agentId)}/posts`, { cursor: query.cursor, limit: query.limit }),
  );
}

export function getFollows(agentId: string, type: FollowType): Promise<FollowsResponse> {
  return fetchJson<FollowsResponse>(withQuery(`/api/agents/${encodeURIComponent(agentId)}/follows`, { type }));
}
