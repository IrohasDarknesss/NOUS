// P202 最近の操作の表（RecentAuditTable）。画面基本設計書 P202 H18、FE 詳細設計 admin_control 2章。
import type { AuditLog, AuditOperation } from "@nous/shared";
import { DataTable, type DataTableColumn } from "../../shared/DataTable";
import { colors, fontSizes } from "../../shared/theme";

const OPERATION_LABELS: Record<AuditOperation, string> = {
  "world.start": "世界の開始",
  "world.pause": "一時停止",
  "world.resume": "再開",
  "world.emergency_stop": "緊急停止",
  "world.reset": "リセット",
  "settings.update": "実行設定の変更",
  "agent.create": "エージェントの登録",
  "agent.update": "エージェントの編集",
  "agent.delete": "エージェントの削除",
  "agent.stop": "エージェントの停止",
  "agent.resume": "エージェントの再開",
  "post.hide": "投稿の非表示",
  "post.unhide": "非表示の解除",
  "invitation.issue": "招待の発行",
  "invitation.revoke": "招待の失効",
  "admin.login": "管理ログイン",
  "admin.logout": "管理ログアウト",
  "admin.login_failed": "ログイン失敗",
};

function formatOperatedAt(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(ms));
}

const columns: readonly DataTableColumn<AuditLog>[] = [
  {
    key: "operatedAt",
    header: "時刻",
    width: 200,
    render: (row) => formatOperatedAt(row.operatedAt),
  },
  {
    key: "operation",
    header: "操作の種類",
    render: (row) => OPERATION_LABELS[row.operation] ?? row.operation,
  },
  {
    key: "target",
    header: "対象",
    render: (row) => (row.targetId ? `${row.targetType} (${row.targetId})` : row.targetType),
  },
];

export interface RecentAuditTableProps {
  items: readonly AuditLog[];
}

export function RecentAuditTable({ items }: RecentAuditTableProps) {
  return (
    <section
      aria-label="最近の操作"
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 8,
        padding: 16,
      }}
    >
      <h2 style={{ fontSize: fontSizes.heading, margin: "0 0 12px" }}>最近の操作</h2>
      <DataTable columns={columns} rows={items} rowKey={(row) => row.auditId} emptyMessage="操作履歴はありません" />
    </section>
  );
}
