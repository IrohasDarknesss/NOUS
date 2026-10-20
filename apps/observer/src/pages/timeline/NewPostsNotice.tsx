import { colors } from "../../lib/theme";

interface Props {
  count: number;
  onClick: () => void;
}

/** 「新しい投稿 N 件」の通知ボタン。0 件のときは出さない */
export function NewPostsNotice({ count, onClick }: Props) {
  if (count <= 0) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: "100%",
        padding: "10px 12px",
        marginBottom: 12,
        border: `1px solid ${colors.primary}`,
        borderRadius: 8,
        background: "#EFF6FF",
        color: colors.primary,
        fontWeight: 600,
        cursor: "pointer",
      }}
    >
      新しい投稿 {count} 件
    </button>
  );
}
