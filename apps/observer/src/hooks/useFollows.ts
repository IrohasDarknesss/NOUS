import { useQuery } from "@tanstack/react-query";
import { getFollows } from "../api/endpoints";
import type { FollowItem, FollowType } from "../api/types";

export interface UseFollowsResult {
  items: FollowItem[];
  isLoading: boolean;
  error: unknown;
  isSuccess: boolean;
}

/**
 * フォロー関係の一覧（['follows', agentId, type]）を取得する（FE 詳細設計 observer 4章）。
 */
export function useFollows(agentId: string, type: FollowType): UseFollowsResult {
  const query = useQuery({
    queryKey: ["follows", agentId, type],
    queryFn: () => getFollows(agentId, type),
    enabled: agentId.length > 0,
  });

  return {
    items: query.data?.items ?? [],
    isLoading: query.isLoading,
    error: query.error,
    isSuccess: query.isSuccess,
  };
}
