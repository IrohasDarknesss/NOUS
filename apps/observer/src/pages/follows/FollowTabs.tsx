import type { FollowType } from "../../api/types";
import { colors } from "../../lib/theme";

export interface FollowCounts {
  following: number;
  followers: number;
}

interface Props {
  type: FollowType;
  counts?: FollowCounts;
  onChange: (type: FollowType) => void;
}

const TABS: ReadonlyArray<{ type: FollowType; label: string }> = [
  { type: "following", label: "フォロー中" },
  { type: "followers", label: "フォロワー" },
];

/** フォロー中・フォロワーのタブ（P104 H07・H08） */
export function FollowTabs({ type, counts, onChange }: Props) {
  return (
    <div
      role="tablist"
      aria-label="フォロー関係の切り替え"
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 8,
        overflow: "hidden",
      }}
    >
      {TABS.map((tab) => {
        const selected = type === tab.type;
        const count = counts ? counts[tab.type] : undefined;
        const text = count !== undefined ? `${tab.label}（${count}）` : tab.label;
        return (
          <button
            key={tab.type}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => {
              if (!selected) onChange(tab.type);
            }}
            style={{
              padding: "10px 12px",
              border: "none",
              borderBottom: selected ? `2px solid ${colors.primary}` : `2px solid transparent`,
              background: colors.surface,
              color: selected ? colors.primary : colors.muted,
              fontWeight: selected ? 700 : 400,
              fontSize: 14,
              cursor: selected ? "default" : "pointer",
            }}
          >
            {text}
          </button>
        );
      })}
    </div>
  );
}
