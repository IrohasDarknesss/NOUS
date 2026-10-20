import { useEffect, useRef, useState } from "react";

export const POLLING_INTERVAL_MS = 30_000;
/** 様式②「最新の投稿を取得できていません」を出すまでの連続の失敗数 */
export const POLLING_FAILURE_THRESHOLD = 3;

function isVisible(): boolean {
  return typeof document === "undefined" || document.visibilityState === "visible";
}

/**
 * 前面にあるときだけ intervalMs、隠れているときは false を返す（useQuery の refetchInterval に渡す）。
 * 前面に戻ったときの即時の再取得は TanStack Query の refetchOnWindowFocus（visibilitychange を見る）に任せる。
 */
export function useVisibilityPolling(intervalMs: number = POLLING_INTERVAL_MS): number | false {
  const [visible, setVisible] = useState(isVisible);
  useEffect(() => {
    const onChange = () => setVisible(isVisible());
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);
  return visible ? intervalMs : false;
}

/**
 * 再取得の連続の失敗数（failureCount）。失敗のたびに 1 増え、成功で 0 に戻る。
 * useQuery の errorUpdatedAt・dataUpdatedAt を渡す。
 */
export function useConsecutiveFailures(query: { errorUpdatedAt: number; dataUpdatedAt: number }): number {
  const [failureCount, setFailureCount] = useState(0);
  const last = useRef({ errorUpdatedAt: query.errorUpdatedAt, dataUpdatedAt: query.dataUpdatedAt });
  useEffect(() => {
    const prev = last.current;
    if (query.dataUpdatedAt !== prev.dataUpdatedAt && query.dataUpdatedAt >= query.errorUpdatedAt) {
      setFailureCount(0);
    } else if (query.errorUpdatedAt !== prev.errorUpdatedAt) {
      setFailureCount((n) => n + 1);
    }
    last.current = { errorUpdatedAt: query.errorUpdatedAt, dataUpdatedAt: query.dataUpdatedAt };
  }, [query.errorUpdatedAt, query.dataUpdatedAt]);
  return failureCount;
}
