// エージェント管理 API（BE 詳細設計 admin_data 2章、FE 詳細設計 admin_agents_logs 1章・3章・4章）
import type {
  AgentCreateResponse,
  AgentDeleteResponse,
  AgentInputRequest,
  AgentListQuery,
  AgentListResponse,
  AgentResumeResponse,
  AgentState,
  AgentStopResponse,
  AgentUpdateResponse,
  Id,
} from "@nous/shared";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { adminFetch } from "./client";

export type AgentFilter = "all" | AgentState;

export const agentsQueryRootKey = ["admin", "agents"] as const;

export function agentsQueryKey(filter: AgentFilter = "all") {
  return [...agentsQueryRootKey, filter] as const;
}

export function listAgents(query: AgentListQuery = {}): Promise<AgentListResponse> {
  const params = new URLSearchParams();
  if (query.state) params.set("state", query.state);
  const qs = params.toString();
  return adminFetch<AgentListResponse>(`/admin/api/agents${qs ? `?${qs}` : ""}`);
}

export function createAgent(input: AgentInputRequest): Promise<AgentCreateResponse> {
  return adminFetch<AgentCreateResponse>("/admin/api/agents", {
    method: "POST",
    body: input,
  });
}

export function updateAgent(agentId: Id, input: AgentInputRequest): Promise<AgentUpdateResponse> {
  return adminFetch<AgentUpdateResponse>(`/admin/api/agents/${encodeURIComponent(agentId)}`, {
    method: "PUT",
    body: input,
  });
}

export function deleteAgent(agentId: Id): Promise<AgentDeleteResponse> {
  return adminFetch<AgentDeleteResponse>(`/admin/api/agents/${encodeURIComponent(agentId)}`, {
    method: "DELETE",
  });
}

export function stopAgent(agentId: Id): Promise<AgentStopResponse> {
  return adminFetch<AgentStopResponse>(`/admin/api/agents/${encodeURIComponent(agentId)}/stop`, {
    method: "POST",
  });
}

export function resumeAgent(agentId: Id): Promise<AgentResumeResponse> {
  return adminFetch<AgentResumeResponse>(`/admin/api/agents/${encodeURIComponent(agentId)}/resume`, {
    method: "POST",
  });
}

export function useAgents(filter: AgentFilter = "all"): UseQueryResult<AgentListResponse> {
  const state: AgentState | undefined = filter === "all" ? undefined : filter;
  return useQuery({
    queryKey: agentsQueryKey(filter),
    queryFn: () => listAgents(state ? { state } : {}),
    retry: false,
  });
}
