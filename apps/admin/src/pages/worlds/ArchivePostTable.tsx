// P211 アーカイブの投稿の表（公開状態つき。読み取り専用で操作ボタンは置かない）
import type { AdminPostItem } from "@nous/shared";
import { formatWorldTime } from "../../layout/worldTime";
import { DataTable, type DataTableColumn } from "../../shared/DataTable";
import { buttonStyle } from "../../shared/Modal";
import { colors } from "../../shared/theme";
import { formatDateTime } from "../invitations/InvitationTable";

export interface ArchivePostTableProps {
  items: readonly AdminPostItem[];
  onLoadMore?: () => void;
  loadingMore?: boolean;
}

export function ArchivePostTable({ items, onLoadMore, loadingMore = false }: ArchivePostTableProps) {
  const columns: readonly DataTableColumn<AdminPostItem>[] = [
    {
      key: "time",
      header: "時刻",
      width: 180,
      render: (post) => (
        <div>
          <div>{formatWorldTime(post.worldTimeSec)}</div>
          <div style={{ color: colors.subText, fontSize: 12 }}>{formatDateTime(post.createdAt)}</div>
        </div>
      ),
    },
    {
      key: "agent",
      header: "エージェント",
      width: 140,
      render: (post) => post.agent.displayName,
    },
    {
      key: "body",
      header: "本文",
      render: (post) => <span style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{post.body}</span>,
    },
    {
      key: "visibility",
      header: "公開状態",
      width: 100,
      render: (post) => {
        const isPublic = post.visibility === "public";
        return (
          <span
            style={{
              display: "inline-block",
              padding: "2px 8px",
              borderRadius: 4,
              background: isPublic ? colors.success : colors.subText,
              color: "#FFFFFF",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            {isPublic ? "公開" : "非表示"}
          </span>
        );
      },
    },
  ];

  return (
    <div>
      <DataTable columns={columns} rows={items} rowKey={(r) => r.postId} emptyMessage="投稿はありません" />
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
