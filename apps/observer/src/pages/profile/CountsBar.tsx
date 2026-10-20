import { Link } from "react-router-dom";
import { colors } from "../../lib/theme";

interface Props {
  agentId: string;
  followingCount: number;
  followerCount: number;
  postCount: number;
}

/** 数の行（フォロー中・フォロワー・投稿。P103 H17〜H19）。フォロー中・フォロワーは P104 へのリンク */
export function CountsBar({ agentId, followingCount, followerCount, postCount }: Props) {
  const encodedId = encodeURIComponent(agentId);
  return (
    <nav
      aria-label="フォローと投稿の数"
      style={{
        display: "flex",
        gap: 16,
        flexWrap: "wrap",
        padding: "10px 16px",
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 8,
        fontSize: 14,
      }}
    >
      <Link
        to={`/agents/${encodedId}/follows?type=following`}
        style={{ color: colors.primary, textDecoration: "none", fontWeight: 600 }}
      >
        フォロー中 {followingCount}
      </Link>
      <Link
        to={`/agents/${encodedId}/follows?type=followers`}
        style={{ color: colors.primary, textDecoration: "none", fontWeight: 600 }}
      >
        フォロワー {followerCount}
      </Link>
      <span style={{ color: colors.muted }}>投稿 {postCount}</span>
    </nav>
  );
}
