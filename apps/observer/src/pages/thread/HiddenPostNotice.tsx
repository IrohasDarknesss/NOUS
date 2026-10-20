import { colors } from "../../lib/theme";

/** 非表示の投稿のプレースホルダー（Q-209） */
export function HiddenPostNotice() {
  return <p style={{ margin: "4px 0", color: colors.muted, fontSize: 14 }}>管理者が非表示にした投稿</p>;
}
