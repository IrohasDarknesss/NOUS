// P207 生成ログ一覧：生成イベントの表（FE 詳細設計 admin_agents_logs 2章、画面基本設計書 P207 4章）
import type { DecidedBy, GenerationItem } from "@nous/shared";
import { formatWorldTime } from "../../layout/worldTime";
import { DataTable, type DataTableColumn } from "../../shared/DataTable";
import { colors } from "../../shared/theme";
import { formatFailureKind, StatusBadge } from "./StatusBadge";

const JST_OFFSET_MS = 9 * 3_600_000;

export const DECIDED_BY_LABELS: Record<DecidedBy, string> = {
  gate: "参加しない",
  llm: "LLM",
};

/** 開始時刻を JST の HH:MM:SS で表す */
export function formatStartedTimeJst(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  const jst = new Date(ms + JST_OFFSET_MS);
  return jst.toISOString().slice(11, 19);
}

export interface GenerationTableProps {
  items: readonly GenerationItem[];
  onRowClick: (item: GenerationItem) => void;
}

export function GenerationTable({ items, onRowClick }: GenerationTableProps) {
  const columns: readonly DataTableColumn<GenerationItem>[] = [
    { key: "startedAt", header: "開始時刻", render: (r) => formatStartedTimeJst(r.startedAt) },
    { key: "worldTimeSec", header: "世界内時間", render: (r) => formatWorldTime(r.worldTimeSec) },
    { key: "agent", header: "エージェント", render: (r) => r.agent.displayName },
    { key: "action", header: "行動", render: (r) => r.action ?? "―" },
    { key: "decidedBy", header: "決め方", render: (r) => DECIDED_BY_LABELS[r.decidedBy] },
    {
      key: "status",
      header: "状態",
      render: (r) => <StatusBadge status={r.status} failureKind={r.failureKind} />,
    },
    {
      key: "failureKind",
      header: "失敗の種類",
      render: (r) =>
        r.status === "failed" || r.status === "cancelled" || r.status === "interrupted"
          ? formatFailureKind(r.failureKind)
          : "―",
    },
    {
      key: "neurons",
      header: "Neurons",
      align: "right",
      render: (r) => (r.decidedBy === "gate" ? "0" : r.neurons.toFixed(1)),
    },
    { key: "attemptCount", header: "試行の回数", align: "right", render: (r) => r.attemptCount },
    {
      key: "consistency",
      header: "矛盾の候補",
      render: (r) =>
        r.hasConsistencyFlags ? <span style={{ color: colors.warning, fontWeight: 600 }}>あり</span> : "―",
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={items}
      rowKey={(r) => r.eventId}
      onRowClick={onRowClick}
      emptyMessage="条件に一致する生成イベントはありません"
    />
  );
}
