// P207 生成ログ一覧・P208 生成ログ詳細の API（FE 詳細設計 admin_agents_logs 1章・4章）
import type {
  AgentListResponse,
  Cursor,
  GenerationDetail,
  GenerationListQuery,
  GenerationPage,
  Id,
} from "@nous/shared";
import { adminFetch } from "./client";

export type GenerationFiltersValue = Omit<GenerationListQuery, "cursor" | "limit">;

export function generationsQueryKey(filters: GenerationFiltersValue) {
  return ["admin", "generations", filters] as const;
}

export function generationDetailQueryKey(eventId: Id) {
  return ["admin", "generation", eventId] as const;
}

export function agentOptionsQueryKey() {
  return ["admin", "agents", "all"] as const;
}

export function listGenerations(filters: GenerationFiltersValue, cursor?: Cursor): Promise<GenerationPage> {
  const params = new URLSearchParams();
  if (filters.agentId) params.set("agentId", filters.agentId);
  if (filters.action) params.set("action", filters.action);
  if (filters.status) params.set("status", filters.status);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (cursor) params.set("cursor", cursor);
  const qs = params.toString();
  return adminFetch<GenerationPage>(`/admin/api/generations${qs ? `?${qs}` : ""}`);
}

export function getGeneration(eventId: Id): Promise<GenerationDetail> {
  return adminFetch<GenerationDetail>(`/admin/api/generations/${encodeURIComponent(eventId)}`);
}

// P207 の絞り込みのエージェントの選択肢（api/agents.ts ができたら寄せる）
export function listAgentOptions(): Promise<AgentListResponse> {
  return adminFetch<AgentListResponse>("/admin/api/agents");
}
