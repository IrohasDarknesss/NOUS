// P209 投稿の表と操作（本文はテキストとして表示）
import type { AdminPostItem } from "@nous/shared";
import { Link } from "react-router-dom";
import { formatWorldTime } from "../../layout/worldTime";
import { DataTable, type DataTableColumn } from "../../shared/DataTable";
import { buttonStyle } from "../../shared/Modal";
import { colors } from "../../shared/theme";
import { formatDateTime } from "../invitations/InvitationTable";

export interface PostModerationTableProps {
  items: readonly AdminPostItem[];
  onHide: (post: AdminPostItem) => void;
  onUnhide: (post: AdminPostItem) => void;
  onOpenLog?: (post: AdminPostItem) => void;
  onLoadMore?: () => void;
  loadingMore?: boolean;
}

export function PostModerationTable({
  items,
  onHide,
  onUnhide,
  onOpenLog,
  onLoadMore,
  loadingMore = false,
}: PostModerationTableProps) {
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
    {
      key: "actions",
      header: "操作",
      width: 200,
      render: (post) => (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {post.visibility === "public" ? (
            <button type="button" onClick={() => onHide(post)} style={buttonStyle}>
              非表示にする
            </button>
          ) : (
            <button type="button" onClick={() => onUnhide(post)} style={buttonStyle}>
              取り消す
            </button>
          )}
          {post.generationEventId !== null && (
            <Link
              to={`/generations/${encodeURIComponent(post.generationEventId)}`}
              onClick={() => onOpenLog?.(post)}
              style={{ color: colors.primary, fontSize: 13 }}
            >
              生成ログ
            </Link>
          )}
        </div>
      ),
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
