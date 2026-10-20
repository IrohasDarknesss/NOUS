import { useQuery } from "@tanstack/react-query";
import { getWorld } from "../api/endpoints";
import type { WorldView } from "../api/types";
import { useVisibilityPolling } from "./useVisibilityPolling";

export interface WorldStatus {
  world: WorldView | undefined;
  /** 最後に取得に成功した時刻（端末の時刻）。まだ成功していなければ null */
  lastUpdated: Date | null;
  isError: boolean;
}

export function useWorldStatus(): WorldStatus {
  const refetchInterval = useVisibilityPolling();
  const query = useQuery({ queryKey: ["world"], queryFn: getWorld, refetchInterval });
  return {
    world: query.data,
    lastUpdated: query.dataUpdatedAt > 0 ? new Date(query.dataUpdatedAt) : null,
    isError: query.isError,
  };
}
