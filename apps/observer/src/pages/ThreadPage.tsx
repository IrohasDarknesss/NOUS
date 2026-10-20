import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { ThreadNode } from "../api/types";
import { useThread } from "../hooks/useThread";
import { POLLING_FAILURE_THRESHOLD, useConsecutiveFailures } from "../hooks/useVisibilityPolling";
import { useBanner } from "../layout/ObserverLayout";
import { colors } from "../lib/theme";
import { ThreadNodeView } from "./thread/ThreadNodeView";

export function ThreadPage() {
  const { postId = "" } = useParams<{ postId: string }>();
  const navigate = useNavigate();
  const { setBanner, reportApiError } = useBanner();
  const { thread, newIds, isError, error, errorUpdatedAt, dataUpdatedAt } = useThread(postId);

  const [extraChildren, setExtraChildren] = useState<Record<string, ThreadNode[]>>({});
  const scrolledPostIdRef = useRef<string | null>(null);

  useEffect(() => {
    setExtraChildren({});
  }, [postId]);

  useEffect(() => {
    if (!thread || scrolledPostIdRef.current === postId) return;
    scrolledPostIdRef.current = postId;
    const el = document.querySelector(`[data-post-id="${thread.focusPostId}"]`);
    el?.scrollIntoView?.({ block: "center" });
  }, [thread, postId]);

  useEffect(() => {
    if (!isError || !error || thread) return;
    reportApiError(error, {
      banner: "スレッドを読み込めませんでした",
      notFound: "この投稿は見つかりません",
    });
  }, [isError, error, thread, reportApiError]);

  const failureCount = useConsecutiveFailures({ errorUpdatedAt, dataUpdatedAt });
  const hadPollingBannerRef = useRef(false);

  useEffect(() => {
    if (failureCount >= POLLING_FAILURE_THRESHOLD) {
      hadPollingBannerRef.current = true;
      if (error) {
        reportApiError(error, { banner: "最新の返信を取得できていません" });
      } else {
        setBanner("最新の返信を取得できていません");
      }
    } else if (failureCount === 0 && hadPollingBannerRef.current) {
      hadPollingBannerRef.current = false;
      setBanner(null);
    }
  }, [failureCount, error, reportApiError, setBanner]);

  const handleLoaded = useCallback((targetPostId: string, children: ThreadNode[]) => {
    setExtraChildren((prev) => ({ ...prev, [targetPostId]: children }));
  }, []);

  const handleBack = () => {
    const state = window.history.state as { idx?: number } | null;
    if (typeof state?.idx === "number" && state.idx > 0) {
      navigate(-1);
    } else {
      navigate("/");
    }
  };

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <a
          href="/"
          onClick={(e) => {
            e.preventDefault();
            handleBack();
          }}
          style={{ color: colors.primary, textDecoration: "none", fontSize: 14 }}
        >
          ← タイムラインへ戻る
        </a>
      </div>
      {thread && (
        <ThreadNodeView
          node={thread.root}
          depth={0}
          focusId={thread.focusPostId}
          newIds={newIds}
          extraChildren={extraChildren}
          onLoaded={handleLoaded}
        />
      )}
    </div>
  );
}
