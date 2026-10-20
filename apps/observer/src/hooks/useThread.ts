import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { getThread } from "../api/endpoints";
import type { ThreadNode } from "../api/types";
import { useVisibilityPolling } from "./useVisibilityPolling";

const THREAD_DEPTH = 5;

function collectPostIds(node: ThreadNode, out: Set<string> = new Set()): Set<string> {
  out.add(node.postId);
  for (const child of node.children) {
    collectPostIds(child, out);
  }
  return out;
}

export function useThread(postId: string) {
  const refetchInterval = useVisibilityPolling();
  const [newIds, setNewIds] = useState<Set<string>>(() => new Set());
  const knownIdsRef = useRef<Set<string> | null>(null);
  const prevPostIdRef = useRef<string>(postId);

  if (prevPostIdRef.current !== postId) {
    prevPostIdRef.current = postId;
    knownIdsRef.current = null;
  }

  const query = useQuery({
    queryKey: ["thread", postId],
    queryFn: () => getThread(postId, { depth: THREAD_DEPTH }),
    enabled: Boolean(postId),
    refetchInterval,
  });

  useEffect(() => {
    if (!query.data) return;
    const currentIds = collectPostIds(query.data.root);
    if (knownIdsRef.current === null) {
      knownIdsRef.current = currentIds;
      setNewIds((prev) => (prev.size === 0 ? prev : new Set()));
      return;
    }
    const added = new Set<string>();
    for (const id of currentIds) {
      if (!knownIdsRef.current.has(id)) {
        added.add(id);
      }
    }
    knownIdsRef.current = new Set([...knownIdsRef.current, ...currentIds]);
    if (added.size > 0) {
      setNewIds(added);
    }
  }, [query.data]);

  useEffect(() => {
    if (newIds.size === 0) return;
    const timer = window.setTimeout(() => {
      setNewIds(new Set());
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [newIds]);

  return {
    thread: query.data,
    newIds,
    isPending: query.isPending,
    isSuccess: query.isSuccess,
    isError: query.isError,
    error: query.error,
    errorUpdatedAt: query.errorUpdatedAt,
    dataUpdatedAt: query.dataUpdatedAt,
  };
}
