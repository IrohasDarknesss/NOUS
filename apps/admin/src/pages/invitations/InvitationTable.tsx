// P210 招待の一覧の表と日時整形
import type { InvitationItem } from "@nous/shared";
import { DataTable, type DataTableColumn } from "../../shared/DataTable";
import { buttonStyle } from "../../shared/Modal";
import { colors } from "../../shared/theme";

const JST_OFFSET_MS = 9 * 3600_000;

/** ISO 8601 の UTC 時刻を JST の「YYYY/MM/DD HH:MM」にする。null は「―」 */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "―";
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "―";
  const jst = new Date(ms + JST_OFFSET_MS);
  const yyyy = jst.getUTCFullYear();
  const mm = String(jst.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(jst.getUTCDate()).padStart(2, "0");
  const hh = String(jst.getUTCHours()).padStart(2, "0");
  const min = String(jst.getUTCMinutes()).padStart(2, "0");
  return `${yyyy}/${mm}/${dd} ${hh}:${min}`;
}

export interface InvitationTableProps {
  items: readonly InvitationItem[];
  onRevoke: (invitation: InvitationItem) => void;
}

export function InvitationTable({ items, onRevoke }: InvitationTableProps) {
  const columns: readonly DataTableColumn<InvitationItem>[] = [
    {
      key: "label",
      header: "表示名",
      render: (row) => row.label,
    },
    {
      key: "issuedAt",
      header: "発行日時",
      width: 180,
      render: (row) => formatDateTime(row.issuedAt),
    },
    {
      key: "lastUsedAt",
      header: "最終利用",
      width: 180,
      render: (row) => formatDateTime(row.lastUsedAt),
    },
    {
      key: "status",
      header: "状態",
      width: 100,
      render: (row) => {
        const active = row.revokedAt === null;
        return (
          <span
            style={{
              display: "inline-block",
              padding: "2px 8px",
              borderRadius: 4,
              background: active ? colors.success : colors.subText,
              color: "#FFFFFF",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            {active ? "有効" : "失効"}
          </span>
        );
      },
    },
    {
      key: "actions",
      header: "操作",
      width: 140,
      render: (row) =>
        row.revokedAt === null ? (
          <button type="button" onClick={() => onRevoke(row)} style={buttonStyle}>
            失効させる
          </button>
        ) : (
          "―"
        ),
    },
  ];

  return (
    <DataTable columns={columns} rows={items} rowKey={(r) => r.invitationId} emptyMessage="招待はまだありません" />
  );
}
