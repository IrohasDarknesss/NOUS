// P211 アーカイブのタブ切り替え（投稿・生成ログ）
import { colors } from "../../shared/theme";

export type ArchiveTab = "posts" | "generations";

export interface ArchiveTabsProps {
  tab: ArchiveTab;
  onChange: (tab: ArchiveTab) => void;
}

const TABS: readonly { value: ArchiveTab; label: string }[] = [
  { value: "posts", label: "投稿" },
  { value: "generations", label: "生成ログ" },
];

export function ArchiveTabs({ tab, onChange }: ArchiveTabsProps) {
  return (
    <div
      role="tablist"
      aria-label="アーカイブ表示のタブ"
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
