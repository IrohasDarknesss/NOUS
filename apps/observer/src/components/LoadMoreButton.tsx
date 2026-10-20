import { colors } from "../lib/theme";

interface Props {
  onClick: () => void;
  loading: boolean;
}

/** 続きの読み込み。読み込み中は「読み込み中…」で押せない */
export function LoadMoreButton({ onClick, loading }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      style={{
        width: "100%",
        padding: "10px 0",
        border: `1px solid ${colors.border}`,
        borderRadius: 8,
        background: colors.surface,
        color: colors.primary,
        cursor: loading ? "default" : "pointer",
      }}
    >
      {loading ? "読み込み中…" : "さらに読み込む"}
    </button>
  );
}
