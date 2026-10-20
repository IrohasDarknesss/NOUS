import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { getAgentProfile } from "../api/endpoints";
import type { FollowType } from "../api/types";
import { EmptyState } from "../components/EmptyState";
import { useFollows } from "../hooks/useFollows";
import { useBanner } from "../layout/ObserverLayout";
import { colors } from "../lib/theme";
import { FollowRow } from "./follows/FollowRow";
import { FollowTabs } from "./follows/FollowTabs";

const FOLLOWS_ERROR_MESSAGES = {
  banner: "一覧を読み込めませんでした。時間をおいて再読み込みしてください",
  notFound: "この住人は見つかりません",
} as const;

function parseFollowType(raw: string | null): FollowType {
  return raw === "followers" ? "followers" : "following";
}

/** P104 フォロー関係（/agents/:agentId/follows?type=following|followers） */
export function FollowsPage() {
  const { agentId = "" } = useParams<{ agentId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const type = parseFollowType(searchParams.get("type"));
  const { reportApiError, setBanner } = useBanner();

  const ownerQuery = useQuery({
    queryKey: ["agent", agentId],
    queryFn: () => getAgentProfile(agentId),
    enabled: agentId.length > 0,
  });

  const { items, isLoading, error: followsError, isSuccess: followsSuccess } = useFollows(agentId, type);

  useEffect(() => {
    const err = ownerQuery.error ?? followsError;
    if (err) {
      reportApiError(err, FOLLOWS_ERROR_MESSAGES);
    }
  }, [ownerQuery.error, followsError, reportApiError]);

  useEffect(() => {
    if (followsSuccess && !ownerQuery.error && !followsError) {
      setBanner(null);
    }
  }, [followsSuccess, ownerQuery.error, followsError, setBanner, type]);

  const changeFollowTab = (nextType: FollowType) => {
    setSearchParams({ type: nextType });
  };

  const owner = ownerQuery.data;
  const counts = owner ? { following: owner.followingCount, followers: owner.followerCount } : undefined;
  const backLabel = owner ? `← ${owner.displayName}のプロフィールへ戻る` : "← プロフィールへ戻る";
  const emptyMessage = type === "following" ? "フォロー中の住人はいません" : "フォロワーはいません";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <h1 style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", margin: 0 }}>
        フォロー関係
      </h1>
      <div>
        <Link
          to={`/agents/${encodeURIComponent(agentId)}`}
          style={{ color: colors.primary, textDecoration: "none", fontSize: 14 }}
        >
          {backLabel}
        </Link>
      </div>
      <FollowTabs type={type} counts={counts} onChange={changeFollowTab} />
      {isLoading ? (
        <p style={{ textAlign: "center", color: colors.muted, padding: "32px 0" }}>読み込み中…</p>
      ) : items.length === 0 && followsSuccess ? (
        <EmptyState message={emptyMessage} />
      ) : (
        <div role="list" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {items.map((item) => (
            <FollowRow key={item.agentId} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}
