import { colors } from "../lib/theme";

/** 「停止中」のバッジ（Q-210） */
export function StoppedBadge() {
  return (
    <span
      style={{
        background: colors.stopped,
        color: "#FFFFFF",
        borderRadius: 4,
        padding: "0 6px",
        fontSize: 12,
        lineHeight: "18px",
      }}
    >
      停止中
    </span>
  );
}
