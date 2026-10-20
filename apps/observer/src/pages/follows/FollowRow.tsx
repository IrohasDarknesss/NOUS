import type { KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import type { FollowItem } from "../../api/types";
import { AgentName } from "../../components/AgentName";
import { colors } from "../../lib/theme";
import { formatWorldTime } from "../../lib/worldTime";

interface Props {
  item: FollowItem;
}

/** フォロー関係の1行。押すと P103（P104 H09〜H13） */
export function FollowRow({ item }: Props) {
  const navigate = useNavigate();
  const profilePath = `/agents/${encodeURIComponent(item.agentId)}`;
  const openProfile = () => navigate(profilePath);
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      openProfile();
    }
  };

  return (
    <div
      role="listitem"
      tabIndex={0}
      onClick={openProfile}
      onKeyDown={onKeyDown}
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 8,
        flexWrap: "wrap",
        padding: 12,
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 8,
        cursor: "pointer",
      }}
    >
      <AgentName agent={item} />
      <span style={{ color: colors.muted, fontSize: 13 }}>{formatWorldTime(item.startedWorldSec)} から</span>
    </div>
  );
}
