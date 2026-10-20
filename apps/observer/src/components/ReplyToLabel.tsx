import type { PostRef } from "../api/types";
import { colors } from "../lib/theme";

/** 返信のとき「返信先：表示名」（Q-208） */
export function ReplyToLabel({ replyTo }: { replyTo: PostRef }) {
  return <p style={{ margin: "4px 0", color: colors.muted, fontSize: 13 }}>返信先：{replyTo.displayName}</p>;
}
