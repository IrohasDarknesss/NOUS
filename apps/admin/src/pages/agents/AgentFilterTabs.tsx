// P203 状態の絞り込みタブ（すべて・稼働・停止）
import type { AgentFilter } from "../../api/agents";
import { buttonStyle, primaryButtonStyle } from "../../shared/Modal";

export interface AgentCounts {
  active: number;
  stopped: number;
}

export interface AgentFilterTabsProps {
  filter: AgentFilter;
  counts?: AgentCounts;
  onChange: (filter: AgentFilter) => void;
}

const TABS: readonly { value: AgentFilter; label: string }[] = [
  { value: "all", label: "すべて" },
  { value: "active", label: "稼働" },
  { value: "stopped", label: "停止" },
];

export function AgentFilterTabs({ filter, onChange }: AgentFilterTabsProps) {
  return (
    <div role="tablist" aria-label="状態の絞り込み" style={{ display: "flex", gap: 8, marginBottom: 16 }}>
      {TABS.map((t) => {
        const selected = filter === t.value;
        return (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(t.value)}
            style={selected ? primaryButtonStyle : buttonStyle}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
