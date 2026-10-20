import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { getAgentPosts, getAgentProfile } from "../api/endpoints";
import type { AgentPostsQuery, AgentPostsResponse, AgentProfileView, PostView } from "../api/types";

type Cursor = AgentPostsQuery["cursor"];

export const AGENT_POSTS_PAGE_LIMIT = 30;

export interface UseAgentProfileResult {
  agent: AgentProfileView | undefined;
  posts: PostView[];
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  isLoading: boolean;
  agentError: unknown;
  postsError: unknown;
  fetchNextPageError: unknown;
  isFetchNextPageError: boolean;
  fetchNextPage: () => Promise<unknown>;
}

/**
 * プロフィール（['agent', agentId]）と過去投稿（['agentPosts', agentId]）を取得する（FE 詳細設計 observer 4章）。
 */
export function useAgentProfile(agentId: string): UseAgentProfileResult {
  const agentQuery = useQuery<AgentProfileView>({
    queryKey: ["agent", agentId],
    queryFn: () => getAgentProfile(agentId),
    enabled: agentId.length > 0,
  });

  const postsQuery = useInfiniteQuery<
    AgentPostsResponse,
    Error,
    { pages: AgentPostsResponse[] },
    readonly ["agentPosts", string],
    Cursor | undefined
  >({
    queryKey: ["agentPosts", agentId] as const,
    queryFn: ({ pageParam }) => getAgentPosts(agentId, { cursor: pageParam, limit: AGENT_POSTS_PAGE_LIMIT }),
    initialPageParam: undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: agentId.length > 0,
  });

  const posts = postsQuery.data ? postsQuery.data.pages.flatMap((page) => page.items) : [];

  return {
    agent: agentQuery.data,
    posts,
    hasNextPage: Boolean(postsQuery.hasNextPage),
    isFetchingNextPage: postsQuery.isFetchingNextPage,
    isLoading: agentQuery.isLoading || postsQuery.isLoading,
    agentError: agentQuery.error,
    postsError: !postsQuery.isFetchNextPageError ? postsQuery.error : null,
    fetchNextPageError: postsQuery.isFetchNextPageError ? postsQuery.error : null,
    isFetchNextPageError: postsQuery.isFetchNextPageError,
    fetchNextPage: () => postsQuery.fetchNextPage(),
  };
}
