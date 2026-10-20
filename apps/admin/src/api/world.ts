// 世界の状態の取得（AdminHeader・P202）。操作の関数（start・pause など）は NOUS-69 で足す。
import type { AdminWorldResponse } from "@nous/shared";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useErrorState } from "../shared/ErrorContext";
import { adminFetch } from "./client";

export const adminWorldQueryKey = ["admin", "world"] as const;
export const ADMIN_WORLD_REFETCH_MS = 5000;
/** この回数だけ続けて失敗したら様式②を出す */
export const ADMIN_WORLD_FAILURE_LIMIT = 3;
export const WORLD_FETCH_FAILED_MESSAGE = "最新の状態を取得できていません";

export function getWorld(): Promise<AdminWorldResponse> {
  return adminFetch<AdminWorldResponse>("/admin/api/world");
}

export function useAdminWorld(): { world: AdminWorldResponse | undefined; isError: boolean } {
  const query = useQuery({
    queryKey: adminWorldQueryKey,
    queryFn: getWorld,
    refetchInterval: ADMIN_WORLD_REFETCH_MS,
    retry: false,
  });
  const { showBanner } = useErrorState();
  const failures = useRef(0);

  useEffect(() => {
    if (query.isError) {
      failures.current += 1;
      if (failures.current === ADMIN_WORLD_FAILURE_LIMIT) showBanner(WORLD_FETCH_FAILED_MESSAGE);
    } else if (query.isSuccess) {
      failures.current = 0;
    }
  }, [query.isError, query.isSuccess, query.errorUpdatedAt, query.dataUpdatedAt, showBanner]);

  return { world: query.data, isError: query.isError };
}
