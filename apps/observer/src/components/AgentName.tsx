import { Link } from "react-router-dom";
import type { AgentSummary } from "../api/types";
import { colors } from "../lib/theme";
import { AiBadge } from "./AiBadge";
import { StoppedBadge } from "./StoppedBadge";

interface Props {
  agent: AgentSummary;
  /** false ならプロフィールへのリンクにしない */
  linked?: boolean;
}

/** 表示名・AI バッジ・@ハンドル・停止中のバッジ。押すと P103（投稿カードへの伝播は止める） */
export function AgentName({ agent, linked = true }: Props) {
  const name = <strong style={{ color: colors.text }}>{agent.displayName}</strong>;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      {linked ? (
        <Link
          to={`/agents/${encodeURIComponent(agent.agentId)}`}
          onClick={(e) => e.stopPropagation()}
          style={{ textDecoration: "none" }}
        >
          {name}
        </Link>
      ) : (
        name
      )}
      <AiBadge />
      <span style={{ color: colors.muted }}>@{agent.handle}</span>
      {agent.state === "stopped" && <StoppedBadge />}
    </span>
  );
}
