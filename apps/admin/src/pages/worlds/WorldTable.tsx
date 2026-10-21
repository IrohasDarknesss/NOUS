// P211 世界の一覧の表（アーカイブの行だけ「開く」ボタンを表示）
import type { WorldItem } from "@nous/shared";
import { WorldStateBadge } from "../../layout/WorldStateBadge";
import { formatWorldTime } from "../../layout/worldTime";
import { DataTable, type DataTableColumn } from "../../shared/DataTable";
import { buttonStyle } from "../../shared/Modal";
import { colors } from "../../shared/theme";
import { formatDateTime } from "../invitations/InvitationTable";

export interface WorldTableProps {
  items: readonly WorldItem[];
  onOpen: (world: WorldItem) => void;
}

export function WorldTable({ items, onOpen }: WorldTableProps) {
  const columns: readonly DataTableColumn<WorldItem>[] = [
    {
      key: "name",
      header: "世界の名前",
      render: (w) => w.name,
    },
    {
      key: "state",
      header: "状態",
      width: 150,
      render: (w) =>
        w.state === "archived" ? (
          <WorldStateBadge state="archived" />
        ) : (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <WorldStateBadge state={w.state} />
            <span style={{ color: colors.subText, fontSize: 12 }}>現在</span>
          </span>
        ),
    },
    {
      key: "createdAt",
      header: "作成日時",
      width: 150,
      render: (w) => formatDateTime(w.createdAt),
    },
    {
      key: "startedAt",
      header: "開始日時",
      width: 150,
      render: (w) => formatDateTime(w.startedAt),
    },
    {
      key: "archivedAt",
      header: "アーカイブ日時",
      width: 150,
      render: (w) => formatDateTime(w.archivedAt),
    },
    {
      key: "worldTimeSec",
      header: "世界内時間",
      width: 130,
      render: (w) => formatWorldTime(w.worldTimeSec),
    },
    {
      key: "agentCount",
      header: "体数",
      width: 70,
      align: "right",
      render: (w) => w.agentCount,
    },
    {
      key: "postCount",
      header: "投稿数",
      width: 80,
      align: "right",
      render: (w) => w.postCount,
    },
    {
      key: "actions",
      header: "操作",
      width: 90,
      render: (w) =>
        w.state === "archived" ? (
          <button type="button" onClick={() => onOpen(w)} style={buttonStyle}>
            開く
          </button>
        ) : (
          "―"
        ),
    },
  ];

  return <DataTable columns={columns} rows={items} rowKey={(r) => r.worldId} emptyMessage="世界はありません" />;
}
