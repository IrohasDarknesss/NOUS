// P209 非表示と取り消しの履歴の表
import type { HideRecordItem } from "@nous/shared";
import { DataTable, type DataTableColumn } from "../../shared/DataTable";
import { buttonStyle } from "../../shared/Modal";
import { formatDateTime } from "../invitations/InvitationTable";

export interface HideHistoryTableProps {
  items: readonly HideRecordItem[];
  onLoadMore?: () => void;
  loadingMore?: boolean;
}

export function HideHistoryTable({ items, onLoadMore, loadingMore = false }: HideHistoryTableProps) {
  const columns: readonly DataTableColumn<HideRecordItem>[] = [
    {
      key: "operatedAt",
      header: "操作の時刻",
      width: 160,
      render: (row) => formatDateTime(row.operatedAt),
    },
    {
      key: "operation",
      header: "操作",
      width: 100,
      render: (row) => (row.operation === "hide" ? "非表示" : "取り消し"),
    },
    {
      key: "postBodyExcerpt",
      header: "本文（先頭 40 字）",
      render: (row) => <span style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{row.postBodyExcerpt}</span>,
    },
    {
      key: "reason",
      header: "理由",
      width: 240,
      render: (row) => (row.reason && row.reason.length > 0 ? row.reason : "―"),
    },
  ];

  return (
    <div>
      <DataTable columns={columns} rows={items} rowKey={(r) => r.hideId} emptyMessage="履歴はまだありません" />
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
