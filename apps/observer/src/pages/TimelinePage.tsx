import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { EmptyState } from "../components/EmptyState";
import { LoadMoreButton } from "../components/LoadMoreButton";
import { PostCard } from "../components/PostCard";
import { useTimeline } from "../hooks/useTimeline";
import { POLLING_FAILURE_THRESHOLD, useConsecutiveFailures } from "../hooks/useVisibilityPolling";
import { useBanner } from "../layout/ObserverLayout";
import { restoreTimelineScroll, saveTimelineScroll } from "../lib/scrollRestore";
import { NewPostsNotice } from "./timeline/NewPostsNotice";

export function TimelinePage() {
  const navigate = useNavigate();
  const { setBanner, reportApiError } = useBanner();
  const {
    pages,
    pendingCount,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    mergePending,
    isSuccess,
    isError,
    isFetchNextPageError,
    error,
    pendingError,
    pendingErrorUpdatedAt,
    pendingDataUpdatedAt,
  } = useTimeline();

  const restoredRef = useRef(false);
  useEffect(() => {
    if (!isSuccess || restoredRef.current) return;
    restoredRef.current = true;
    restoreTimelineScroll();
  }, [isSuccess]);

  useEffect(() => {
    if (!isError || !error) return;
    if (isFetchNextPageError) {
      reportApiError(error, { banner: "続きを読み込めませんでした" });
    } else {
      reportApiError(error, { banner: "投稿を読み込めませんでした。時間をおいて再読み込みしてください" });
    }
  }, [isError, isFetchNextPageError, error, reportApiError]);

  const failureCount = useConsecutiveFailures({
    errorUpdatedAt: pendingErrorUpdatedAt,
    dataUpdatedAt: pendingDataUpdatedAt,
  });
  const hadPollingBannerRef = useRef(false);

  useEffect(() => {
    if (failureCount >= POLLING_FAILURE_THRESHOLD) {
      hadPollingBannerRef.current = true;
      if (pendingError) {
        reportApiError(pendingError, { banner: "最新の投稿を取得できていません" });
      } else {
        setBanner("最新の投稿を取得できていません");
      }
    } else if (failureCount === 0 && hadPollingBannerRef.current) {
      hadPollingBannerRef.current = false;
      setBanner(null);
    }
  }, [failureCount, pendingError, reportApiError, setBanner]);

  const handleOpen = (postId: string) => {
    saveTimelineScroll();
    navigate(`/posts/${postId}`);
  };

  return (
    <div>
      <NewPostsNotice count={pendingCount} onClick={mergePending} />
      {isSuccess && pages.length === 0 ? (
        <EmptyState message="まだ投稿はありません" />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {pages.map((post) => (
            <PostCard key={post.postId} post={post} onOpen={handleOpen} />
          ))}
        </div>
      )}
      {hasNextPage && (
        <div style={{ marginTop: 12 }}>
          <LoadMoreButton onClick={() => void fetchNextPage()} loading={isFetchingNextPage} />
        </div>
      )}
    </div>
  );
}
