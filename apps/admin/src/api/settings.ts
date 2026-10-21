// 実行設定の API（getSettings・updateSettings）。FE 詳細設計 admin_control 1章・4章、BE 詳細設計 world 2章。
import type { SettingsResponse, SettingsUpdateRequest, SettingsUpdateResponse } from "@nous/shared";
import { adminFetch } from "./client";

export const adminSettingsQueryKey = ["admin", "settings"] as const;

export function getSettings(): Promise<SettingsResponse> {
  return adminFetch<SettingsResponse>("/admin/api/settings");
}

export function updateSettings(body: SettingsUpdateRequest): Promise<SettingsUpdateResponse> {
  return adminFetch<SettingsUpdateResponse>("/admin/api/settings", { method: "PUT", body });
}
