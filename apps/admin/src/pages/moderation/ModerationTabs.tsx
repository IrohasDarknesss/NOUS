// P209 タブ切り替え（投稿の検索・非表示の履歴）
import { colors } from "../../shared/theme";

export type ModerationTab = "search" | "history";

export interface ModerationTabsProps {
  tab: ModerationTab;
  onChange: (tab: ModerationTab) => void;
}

const TABS: readonly { value: ModerationTab; label: string }[] = [
  { value: "search", label: "投稿の検索" },
  { value: "history", label: "非表示の履歴" },
];

export function ModerationTabs({ tab, onChange }: ModerationTabsProps) {
  return (
    <div
      role="tablist"
      aria-label="非表示管理のタブ"
      style={{
        display: "flex",
        gap: 4,
        borderBottom: `1px solid ${colors.border}`,
        marginBottom: 16,
      }}
    >
      {TABS.map((item) => {
        const selected = tab === item.value;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => {
              if (!selected) onChange(item.value);
            }}
            style={{
              padding: "10px 16px",
              border: "none",
              borderBottom: selected ? `2px solid ${colors.primary}` : "2px solid transparent",
              background: "transparent",
              color: selected ? colors.primary : colors.subText,
              fontWeight: selected ? 700 : 400,
              fontSize: 14,
              cursor: selected ? "default" : "pointer",
            }}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
