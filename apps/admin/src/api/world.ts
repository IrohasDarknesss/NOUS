// 世界の状態の取得と制御操作（AdminHeader・P202）。FE 詳細設計 admin_control 1章・4章、BE 詳細設計 world 2章。
import type {
  AdminWorldResponse,
  AuditLogListResponse,
  WorldEmergencyStopResponse,
  WorldPauseResponse,
  WorldResetRequest,
  WorldResetResponse,
  WorldResumeResponse,
  WorldStartResponse,
} from "@nous/shared";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useErrorState } from "../shared/ErrorContext";
import { adminFetch } from "./client";

export const adminWorldQueryKey = ["admin", "world"] as const;
export const adminAuditQueryKey = ["admin", "audit"] as const;
export const ADMIN_WORLD_REFETCH_MS = 5000;
/** この回数だけ続けて失敗したら様式②を出す */
export const ADMIN_WORLD_FAILURE_LIMIT = 3;
export const WORLD_FETCH_FAILED_MESSAGE = "最新の状態を取得できていません";

export function getWorld(): Promise<AdminWorldResponse> {
  return adminFetch<AdminWorldResponse>("/admin/api/world");
}

export function start(): Promise<WorldStartResponse> {
  return adminFetch<WorldStartResponse>("/admin/api/world/start", { method: "POST" });
}

export function pause(): Promise<WorldPauseResponse> {
  return adminFetch<WorldPauseResponse>("/admin/api/world/pause", { method: "POST" });
}

export function resume(): Promise<WorldResumeResponse> {
  return adminFetch<WorldResumeResponse>("/admin/api/world/resume", { method: "POST" });
}

export function emergencyStop(): Promise<WorldEmergencyStopResponse> {
  return adminFetch<WorldEmergencyStopResponse>("/admin/api/world/emergency-stop", { method: "POST" });
}

export function reset(request: WorldResetRequest): Promise<WorldResetResponse> {
  return adminFetch<WorldResetResponse>("/admin/api/world/reset", { method: "POST", body: request });
}

export function getAuditLogs(limit = 10): Promise<AuditLogListResponse> {
  return adminFetch<AuditLogListResponse>(`/admin/api/audit-logs?limit=${limit}`);
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
