// P203 行ごとの操作ボタン（停止・再開・編集・削除・生成ログ）。FE 詳細設計 admin_agents_logs 2章・4章
import type { AdminAgentItem, WorldState } from "@nous/shared";
import { Link } from "react-router-dom";
import { buttonStyle, dangerButtonStyle } from "../../shared/Modal";

export type RowAction = "stop" | "resume" | "edit" | "delete" | "logs";

export interface RowActionStates {
  stop: boolean;
  resume: boolean;
  edit: boolean;
  delete: boolean;
  logs: boolean;
}

/**
 * 行ごとの操作ボタンの出し分け（IPO 表 rowActionStates）:
 * 1. 停止：agent が active かつ世界が preparing・archived でない
 * 2. 再開：agent が stopped
 * 3. 編集・削除：世界が preparing
 * 4. 生成ログ：世界が preparing でない
 */
export function rowActionStates(
  agent: Pick<AdminAgentItem, "state">,
  worldState: WorldState,
): Record<RowAction, boolean> {
  const isPreparing = worldState === "preparing";
  const isArchived = worldState === "archived";
  return {
    stop: agent.state === "active" && !isPreparing && !isArchived,
    resume: agent.state === "stopped",
    edit: isPreparing,
    delete: isPreparing,
    logs: !isPreparing,
  };
}

export interface AgentRowActionsProps {
  agent: AdminAgentItem;
  worldState: WorldState;
  onStop: (agent: AdminAgentItem) => void;
  onResume: (agent: AdminAgentItem) => void;
  onDelete: (agent: AdminAgentItem) => void;
}

const smallButtonStyle = {
  ...buttonStyle,
  padding: "4px 10px",
  fontSize: 13,
} as const;

const smallDangerStyle = {
  ...dangerButtonStyle,
  padding: "4px 10px",
  fontSize: 13,
} as const;

export function AgentRowActions({ agent, worldState, onStop, onResume, onDelete }: AgentRowActionsProps) {
  const states = rowActionStates(agent, worldState);

  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
      {states.stop && (
        <button type="button" onClick={() => onStop(agent)} style={smallButtonStyle}>
          停止
        </button>
      )}
      {states.resume && (
        <button type="button" onClick={() => onResume(agent)} style={smallButtonStyle}>
          再開
        </button>
      )}
      {states.edit && (
        <Link
          to={`/agents/${encodeURIComponent(agent.agentId)}/edit`}
          style={{ ...smallButtonStyle, textDecoration: "none", display: "inline-block" }}
        >
          編集
        </Link>
      )}
      {states.delete && (
        <button type="button" onClick={() => onDelete(agent)} style={smallDangerStyle}>
          削除
        </button>
      )}
      {states.logs && (
        <Link
          to={`/generations?agentId=${encodeURIComponent(agent.agentId)}`}
          style={{ ...smallButtonStyle, textDecoration: "none", display: "inline-block" }}
        >
          生成ログ
        </Link>
      )}
    </div>
  );
}
