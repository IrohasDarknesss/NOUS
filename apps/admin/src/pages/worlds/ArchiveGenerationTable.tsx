// P211 アーカイブの生成イベントの表（P207 と同じ列。行クリックで /generations/{eventId}）
import type { FailureKind, GenerationItem, GenerationStatus, Id } from "@nous/shared";
import { formatWorldTime } from "../../layout/worldTime";
import { DataTable, type DataTableColumn } from "../../shared/DataTable";
import { buttonStyle } from "../../shared/Modal";
import { colors } from "../../shared/theme";

const JST_OFFSET_MS = 9 * 3600_000;

function formatStartedAtJst(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "―";
  const jst = new Date(ms + JST_OFFSET_MS);
  const hh = String(jst.getUTCHours()).padStart(2, "0");
  const mm = String(jst.getUTCMinutes()).padStart(2, "0");
  const ss = String(jst.getUTCSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

const STATUS_LABELS: Record<GenerationStatus, { label: string; color: string }> = {
  succeeded: { label: "成功", color: colors.success },
  failed: { label: "失敗", color: colors.danger },
  cancelled: { label: "取り消し", color: "#EA580C" },
  interrupted: { label: "中断", color: colors.subText },
  running: { label: "実行中", color: colors.primary },
};

const FAILURE_KIND_LABELS: Record<FailureKind, string> = {
  timeout: "タイムアウト",
  rate_limited: "レート制限",
  server_error: "サーバーのエラー",
  invalid_format: "不正な形式",
  free_tier: "無料枠",
  cancelled: "取り消し",
  stopped: "停止",
  interrupted: "中断",
};

export interface ArchiveGenerationTableProps {
  items: readonly GenerationItem[];
  onRowClick: (eventId: Id) => void;
  onLoadMore?: () => void;
  loadingMore?: boolean;
}

export function ArchiveGenerationTable({
  items,
  onRowClick,
  onLoadMore,
  loadingMore = false,
}: ArchiveGenerationTableProps) {
  const columns: readonly DataTableColumn<GenerationItem>[] = [
    {
      key: "startedAt",
      header: "開始時刻",
      width: 90,
      render: (row) => formatStartedAtJst(row.startedAt),
    },
    {
      key: "worldTimeSec",
      header: "世界内時間",
      width: 120,
      render: (row) => formatWorldTime(row.worldTimeSec),
    },
    {
      key: "agent",
      header: "エージェント",
      width: 130,
      render: (row) => row.agent.displayName,
    },
    {
      key: "action",
      header: "行動",
      width: 80,
      render: (row) => row.action ?? "―",
    },
    {
      key: "decidedBy",
      header: "決め方",
      width: 90,
      render: (row) => (row.decidedBy === "gate" ? "参加しない" : "LLM"),
    },
    {
      key: "status",
      header: "状態",
      width: 90,
      render: (row) => {
        const info = STATUS_LABELS[row.status];
        return (
          <span
            style={{
              display: "inline-block",
              padding: "2px 8px",
              borderRadius: 4,
              background: info.color,
              color: "#FFFFFF",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            {info.label}
          </span>
        );
      },
    },
    {
      key: "failureKind",
      header: "失敗の種類",
      width: 120,
      render: (row) => (row.failureKind ? FAILURE_KIND_LABELS[row.failureKind] : "―"),
    },
    {
      key: "neurons",
      header: "Neurons",
      width: 80,
      align: "right",
      render: (row) => row.neurons.toFixed(1),
    },
    {
      key: "attemptCount",
      header: "試行",
      width: 60,
      align: "right",
      render: (row) => row.attemptCount,
    },
    {
      key: "consistency",
      header: "矛盾の候補",
      width: 90,
      render: (row) => (row.hasConsistencyFlags ? "あり" : "―"),
    },
  ];

  return (
    <div>
      <DataTable
        columns={columns}
        rows={items}
        rowKey={(r) => r.eventId}
        onRowClick={(row) => onRowClick(row.eventId)}
        emptyMessage="生成ログはありません"
      />
      {onLoadMore && (
        <div style={{ marginTop: 12, textAlign: "center" }}>
          <button type="button" onClick={onLoadMore} disabled={loadingMore} style={buttonStyle}>
            {loadingMore ? "読み込み中…" : "さらに読み込む"}
          </button>
        </div>
      )}
    </div>
  );
}
