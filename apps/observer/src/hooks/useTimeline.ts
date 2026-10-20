import { useInfiniteQuery, useQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { getTimeline } from "../api/endpoints";
import type { PostView, TimelinePage } from "../api/types";
import { useVisibilityPolling } from "./useVisibilityPolling";

const TIMELINE_LIMIT = 30;

export function useTimeline() {
  const queryClient = useQueryClient();
  const refetchInterval = useVisibilityPolling();

  const timelineQuery = useInfiniteQuery({
    queryKey: ["timeline"],
    queryFn: ({ pageParam }) => getTimeline({ cursor: pageParam, limit: TIMELINE_LIMIT }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  const pages = useMemo<PostView[]>(
    () => timelineQuery.data?.pages.flatMap((page) => page.items ?? []) ?? [],
    [timelineQuery.data],
  );

  const headPostId = pages[0]?.postId;

  const pendingQuery = useQuery({
    queryKey: ["timeline", "pending"],
    queryFn: () => getTimeline({ since: headPostId, limit: TIMELINE_LIMIT }),
    enabled: Boolean(headPostId),
    refetchInterval,
  });

  const pendingCount = useMemo(() => {
    const pendingItems = pendingQuery.data?.items ?? [];
    if (pendingItems.length === 0) return 0;
    const existingIds = new Set(pages.map((post) => post.postId));
    const unseenIds = new Set<string>();
    for (const item of pendingItems) {
      if (!existingIds.has(item.postId)) {
        unseenIds.add(item.postId);
      }
    }
    return unseenIds.size;
  }, [pendingQuery.data, pages]);

  const mergePending = useCallback(() => {
    const pendingData = queryClient.getQueryData<TimelinePage>(["timeline", "pending"]);
    const pendingItems = pendingData?.items ?? [];

    queryClient.setQueryData<InfiniteData<TimelinePage>>(["timeline"], (old) => {
      if (!old || old.pages.length === 0) return old;
      const existingIds = new Set(old.pages.flatMap((page) => page.items.map((item) => item.postId)));
      const toPrepend: PostView[] = [];
      for (const item of pendingItems) {
        if (!existingIds.has(item.postId)) {
          existingIds.add(item.postId);
          toPrepend.push(item);
        }
      }
      if (toPrepend.length === 0) return old;
      const [firstPage, ...restPages] = old.pages;
      if (!firstPage) return old;
      return {
        ...old,
        pages: [{ ...firstPage, items: [...toPrepend, ...firstPage.items] }, ...restPages],
      };
    });

    queryClient.setQueryData<TimelinePage>(["timeline", "pending"], (old) => (old ? { ...old, items: [] } : undefined));

    window.scrollTo(0, 0);
  }, [queryClient]);

  return {
    pages,
    pendingCount,
    fetchNextPage: timelineQuery.fetchNextPage,
    hasNextPage: timelineQuery.hasNextPage,
    isFetchingNextPage: timelineQuery.isFetchingNextPage,
    mergePending,
    isPending: timelineQuery.isPending,
    isSuccess: timelineQuery.isSuccess,
    isError: timelineQuery.isError,
    isFetchNextPageError: timelineQuery.isFetchNextPageError,
    error: timelineQuery.error,
    pendingError: pendingQuery.error,
    pendingErrorUpdatedAt: pendingQuery.errorUpdatedAt,
    pendingDataUpdatedAt: pendingQuery.dataUpdatedAt,
  };
}
