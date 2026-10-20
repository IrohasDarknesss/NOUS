// P203 エージェント一覧（FE 詳細設計 admin_agents_logs 1〜6章、画面基本設計書 P203）
import type { AdminAgentItem, WorldState } from "@nous/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { agentsQueryRootKey, deleteAgent, resumeAgent, stopAgent, useAgents, type AgentFilter } from "../api/agents";
import { adminWorldQueryKey, useAdminWorld } from "../api/world";
import { ConfirmDialog } from "../shared/ConfirmDialog";
import { primaryButtonStyle } from "../shared/Modal";
import { fontSizes } from "../shared/theme";
import { useToast } from "../shared/Toast";
import { useApiErrorHandler } from "../shared/useApiErrorHandler";
import { AgentFilterTabs } from "./agents/AgentFilterTabs";
import { AgentTable } from "./agents/AgentTable";

export const AGENT_CONFLICT_MESSAGE = "エージェントの状態が変わったため、操作できませんでした。一覧を更新します";
export const AGENT_STOPPED_TOAST = "停止しました。次の行動機会から割り当てません";

export type ConfirmState = { kind: "stop"; agent: AdminAgentItem } | { kind: "delete"; agent: AdminAgentItem };

export function AgentListPage() {
  const [filter, setFilter] = useState<AgentFilter>("all");
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  const query = useAgents(filter);
  const { world } = useAdminWorld();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const handleError = useApiErrorHandler();

  useEffect(() => {
    if (query.error) {
      handleError(query.error);
    }
  }, [query.error, handleError]);

  const items = query.data?.items ?? [];
  const worldState: WorldState = query.data?.worldState ?? world?.state ?? "running";

  const activeCount = world?.agentCounts?.active ?? items.filter((a) => a.state === "active").length;
  const stoppedCount = world?.agentCounts?.stopped ?? items.filter((a) => a.state === "stopped").length;

  const invalidateAgents = async () => {
    await queryClient.invalidateQueries({ queryKey: agentsQueryRootKey });
    await queryClient.invalidateQueries({ queryKey: adminWorldQueryKey });
  };

  const handleStop = (agent: AdminAgentItem) => {
    setConfirm({ kind: "stop", agent });
  };

  const confirmStop = async (agent: AdminAgentItem) => {
    try {
      await stopAgent(agent.agentId);
      setConfirm(null);
      await invalidateAgents();
      showToast(AGENT_STOPPED_TOAST);
    } catch (e) {
      setConfirm(null);
      handleError(e, {
        conflictMessage: AGENT_CONFLICT_MESSAGE,
        invalidateKeys: [agentsQueryRootKey, adminWorldQueryKey],
      });
    }
  };

  const handleResume = async (agent: AdminAgentItem) => {
    try {
      await resumeAgent(agent.agentId);
      await invalidateAgents();
    } catch (e) {
      handleError(e, {
        conflictMessage: AGENT_CONFLICT_MESSAGE,
        invalidateKeys: [agentsQueryRootKey, adminWorldQueryKey],
      });
    }
  };

  const handleDelete = (agent: AdminAgentItem) => {
    setConfirm({ kind: "delete", agent });
  };

  const confirmDelete = async (agent: AdminAgentItem) => {
    try {
      await deleteAgent(agent.agentId);
      setConfirm(null);
      await invalidateAgents();
    } catch (e) {
      setConfirm(null);
      handleError(e, {
        conflictMessage: AGENT_CONFLICT_MESSAGE,
        invalidateKeys: [agentsQueryRootKey, adminWorldQueryKey],
      });
    }
  };

  const isPreparing = worldState === "preparing";

  return (
    <section data-screen-id="P203">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16,
        }}
      >
        <h1 style={{ fontSize: fontSizes.heading, margin: 0 }}>
          エージェント（稼働 {activeCount}・停止 {stoppedCount}）
          <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
            P203
          </span>
        </h1>
        {isPreparing && (
          <Link to="/agents/new" style={{ ...primaryButtonStyle, textDecoration: "none", display: "inline-block" }}>
            新規登録
          </Link>
        )}
      </div>

      <AgentFilterTabs filter={filter} counts={{ active: activeCount, stopped: stoppedCount }} onChange={setFilter} />

      <AgentTable
        items={items}
        worldState={worldState}
        onStop={handleStop}
        onResume={(agent) => void handleResume(agent)}
        onDelete={handleDelete}
      />

      {items.length === 0 && isPreparing && (
        <div style={{ marginTop: 12, textAlign: "center" }}>
          <Link to="/agents/new" style={{ ...primaryButtonStyle, textDecoration: "none", display: "inline-block" }}>
            新規登録
          </Link>
        </div>
      )}

      {confirm?.kind === "stop" && (
        <ConfirmDialog
          title="エージェントの停止"
          message="停止しますか。次の行動機会から割り当てません"
          confirmLabel="停止する"
          onConfirm={() => confirmStop(confirm.agent)}
          onCancel={() => setConfirm(null)}
        />
      )}

      {confirm?.kind === "delete" && (
        <ConfirmDialog
          title="エージェントの削除"
          message="削除しますか。元に戻せません"
          confirmLabel="削除する"
          danger
          onConfirm={() => confirmDelete(confirm.agent)}
          onCancel={() => setConfirm(null)}
        />
      )}
    </section>
  );
}
