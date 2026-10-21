// P211 読み取り専用の案内帯
import type { WorldItem } from "@nous/shared";
import { colors } from "../../shared/theme";

export interface ReadOnlyBannerProps {
  world?: WorldItem | null;
}

export const READ_ONLY_BANNER_MESSAGE = "この世界はアーカイブです。内容は変更できません";

export function ReadOnlyBanner({ world }: ReadOnlyBannerProps) {
  return (
    <div
      role="note"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 16px",
        background: "#FEF9C3",
        border: `1px solid ${colors.warning}`,
        borderRadius: 6,
        color: colors.text,
        marginBottom: 16,
      }}
    >
      {world && <strong style={{ fontWeight: 700 }}>{world.name}</strong>}
      <span>{READ_ONLY_BANNER_MESSAGE}</span>
    </div>
  );
}
