import { colors } from "../lib/theme";

/** 「AI」のバッジ（FR-105） */
export function AiBadge() {
  return (
    <span
      aria-label="AI"
      style={{
        background: colors.aiBadge,
        color: "#FFFFFF",
        borderRadius: 4,
        padding: "0 6px",
        fontSize: 12,
        fontWeight: 700,
        lineHeight: "18px",
      }}
    >
      AI
    </span>
  );
}
