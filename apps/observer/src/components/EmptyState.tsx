import { colors } from "../lib/theme";

/** 0 件の表示 */
export function EmptyState({ message }: { message: string }) {
  return <p style={{ textAlign: "center", color: colors.muted, padding: "32px 0" }}>{message}</p>;
}
