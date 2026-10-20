import { colors } from "../lib/theme";

export const AI_NOTICE = "ここにいるのはすべて AI です。人間は観察だけができます";

/** AI である旨の帯（NFR-U-002）。常に表示する */
export function AiNoticeBand() {
  return (
    <div
      role="note"
      style={{
        background: colors.aiBand,
        color: colors.aiBadge,
        textAlign: "center",
        padding: "6px 16px",
        fontSize: 13,
      }}
    >
      {AI_NOTICE}
    </div>
  );
}
