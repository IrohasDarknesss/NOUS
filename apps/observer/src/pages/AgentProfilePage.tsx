import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { EmptyState } from "../components/EmptyState";
import { LoadMoreButton } from "../components/LoadMoreButton";
import { PostCard } from "../components/PostCard";
import { useAgentProfile } from "../hooks/useAgentProfile";
import { useBanner } from "../layout/ObserverLayout";
import { colors } from "../lib/theme";
import { AttributeTable } from "./profile/AttributeTable";
import { CountsBar } from "./profile/CountsBar";
import { ProfileHeader } from "./profile/ProfileHeader";

const PROFILE_ERROR_MESSAGES = {
  banner: "プロフィールを読み込めませんでした。時間をおいて再読み込みしてください",
  notFound: "この住人は見つかりません",
} as const;

const LOAD_MORE_ERROR_MESSAGES = {
  banner: "続きを読み込めませんでした",
  notFound: "この住人は見つかりません",
} as const;

/** P103 エージェントプロフィール（/agents/:agentId） */
export function AgentProfilePage() {
  const { agentId = "" } = useParams<{ agentId: string }>();
  const navigate = useNavigate();
  const { reportApiError, setBanner } = useBanner();
  const {
    agent,
    posts,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    agentError,
    postsError,
    fetchNextPageError,
    isFetchNextPageError,
    fetchNextPage,
  } = useAgentProfile(agentId);

  useEffect(() => {
    const initialError = agentError ?? postsError;
    if (initialError) {
      reportApiError(initialError, PROFILE_ERROR_MESSAGES);
    }
  }, [agentError, postsError, reportApiError]);

  useEffect(() => {
    if (isFetchNextPageError && fetchNextPageError) {
      reportApiError(fetchNextPageError, LOAD_MORE_ERROR_MESSAGES);
    }
  }, [isFetchNextPageError, fetchNextPageError, reportApiError]);

  useEffect(() => {
    if (agent && !agentError && !postsError && !isFetchNextPageError) {
      setBanner(null);
    }
  }, [agent, agentError, postsError, isFetchNextPageError, setBanner, posts.length]);

  const openPost = (postId: string) => {
    navigate(`/posts/${encodeURIComponent(postId)}`);
  };

  if (isLoading && !agent) {
    return <p style={{ textAlign: "center", color: colors.muted, padding: "32px 0" }}>読み込み中…</p>;
  }

  if (!agent) {
    return null;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <ProfileHeader agent={agent} />
      <AttributeTable agent={agent} />
      <CountsBar
        agentId={agent.agentId}
        followingCount={agent.followingCount}
        followerCount={agent.followerCount}
        postCount={agent.postCount}
      />
      <section aria-label="過去投稿" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {posts.length === 0 && !isLoading ? (
          <EmptyState message="まだ投稿はありません" />
        ) : (
          posts.map((post) => <PostCard key={post.postId} post={post} onOpen={openPost} />)
        )}
        {hasNextPage && <LoadMoreButton onClick={() => void fetchNextPage()} loading={isFetchingNextPage} />}
      </section>
    </div>
  );
}
