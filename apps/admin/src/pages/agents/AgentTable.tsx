// P203 エージェントの表（DataTable で描画）
import type { Action, AdminAgentItem, AgentState, WorldState } from "@nous/shared";
import { DataTable, type DataTableColumn } from "../../shared/DataTable";
import { colors } from "../../shared/theme";
import { AgentRowActions } from "./AgentRowActions";

export interface AgentTableProps {
  items: readonly AdminAgentItem[];
  worldState: WorldState;
  onStop: (agent: AdminAgentItem) => void;
  onResume: (agent: AdminAgentItem) => void;
  onDelete: (agent: AdminAgentItem) => void;
}

const STATE_LABELS: Record<AgentState, string> = {
  active: "稼働",
  stopped: "停止",
};

/** ISO 8601 の UTC 日時を JST の HH:MM に変換する */
export function formatJstTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const jstMs = date.getTime() + 9 * 60 * 60 * 1000;
  const jst = new Date(jstMs);
  const hh = String(jst.getUTCHours()).padStart(2, "0");
  const mm = String(jst.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

export function formatLastAction(lastActionAt: string | null, lastAction: Action | null): string {
  if (!lastActionAt) return "―";
  const time = formatJstTime(lastActionAt);
  return lastAction ? `${time} ${lastAction}` : time;
}

function AgentStateBadge({ state }: { state: AgentState }) {
  const bg = state === "active" ? colors.success : colors.subText;
  return (
    <span
      data-agent-state={state}
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 4,
        background: bg,
        color: "#FFFFFF",
        fontWeight: 600,
        fontSize: 12,
      }}
    >
      {STATE_LABELS[state]}
    </span>
  );
}

export function AgentTable({ items, worldState, onStop, onResume, onDelete }: AgentTableProps) {
  const columns: readonly DataTableColumn<AdminAgentItem>[] = [
    {
      key: "displayName",
      header: "表示名",
      render: (r) => r.displayName,
    },
    {
      key: "handle",
      header: "ハンドル",
      render: (r) => `@${r.handle}`,
    },
    {
      key: "state",
      header: "状態",
      render: (r) => <AgentStateBadge state={r.state} />,
    },
    {
      key: "activityLevel",
      header: "活動頻度",
      align: "right",
      render: (r) => r.activityLevel,
    },
    {
      key: "postCount",
      header: "投稿数",
      align: "right",
      render: (r) => r.postCount,
    },
    {
      key: "lastAction",
      header: "最後の行動",
      render: (r) => formatLastAction(r.lastActionAt, r.lastAction),
    },
    {
      key: "actions",
      header: "操作",
      render: (r) => (
        <AgentRowActions agent={r} worldState={worldState} onStop={onStop} onResume={onResume} onDelete={onDelete} />
      ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={items}
      rowKey={(r) => r.agentId}
      emptyMessage="エージェントが登録されていません"
    />
  );
}
