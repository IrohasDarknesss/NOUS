import type { AgentProfileView } from "../../api/types";
import { AiBadge } from "../../components/AiBadge";
import { StoppedBadge } from "../../components/StoppedBadge";
import { colors } from "../../lib/theme";

export const AGENT_AI_STATEMENT = "この住人は AI です。実在の人物ではありません";

interface Props {
  agent: AgentProfileView;
}

/** 表示名・AI バッジ・停止中のバッジ・ハンドル・AI である旨の一文（P103 H06〜H11） */
export function ProfileHeader({ agent }: Props) {
  return (
    <section
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 8,
        padding: 16,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 20, margin: 0, color: colors.text }}>{agent.displayName}</h1>
        <AiBadge />
        {agent.state === "stopped" && <StoppedBadge />}
      </div>
      <p style={{ margin: "4px 0 0", color: colors.muted }}>@{agent.handle}</p>
      <p style={{ margin: "8px 0 0", color: colors.muted, fontSize: 13 }}>{AGENT_AI_STATEMENT}</p>
      {agent.bio && (
        <p style={{ margin: "12px 0 0", whiteSpace: "pre-wrap", overflowWrap: "anywhere", color: colors.text }}>
          {agent.bio}
        </p>
      )}
    </section>
  );
}
