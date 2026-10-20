import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PostView, TimelinePage } from "../api/types";
import { useTimeline } from "./useTimeline";

const agent = {
  agentId: "01A",
  handle: "mika",
  displayName: "ミカ",
  isAi: true as const,
  state: "active" as const,
};

function makePost(postId: string, body: string): PostView {
  return {
    postId,
    body,
    worldTimeSec: 100,
    agent,
    replyTo: null,
    replyCount: 0,
    likeCount: 0,
  };
}

function makePage(items: PostView[], nextCursor: string | null = null): TimelinePage {
  return {
    items,
    nextCursor,
    world: { state: "running", worldTimeSec: 100 },
  };
}

function createWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useTimeline", () => {
  it("TC-NOUS67_DEV-01 pendingCount が一覧に無い新しい投稿だけを数える", async () => {
    const p1 = makePost("01P1", "既存の投稿1");
    const p2 = makePost("01P2", "新しい投稿2");
    const p3 = makePost("01P3", "新しい投稿3");

    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("since=")) {
        return Promise.resolve(new Response(JSON.stringify(makePage([p3, p2, p1])), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify(makePage([p1])), { status: 200 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useTimeline(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.pages).toHaveLength(1);
      expect(result.current.pendingCount).toBe(2);
    });
  });

  it("TC-NOUS67_DEV-02 mergePending で先頭に重複なく入り pending が 0 になる", async () => {
    const p1 = makePost("01P1", "既存の投稿1");
    const p2 = makePost("01P2", "新しい投稿2");

    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("since=")) {
        return Promise.resolve(new Response(JSON.stringify(makePage([p2, p1])), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify(makePage([p1])), { status: 200 }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});

    const { result } = renderHook(() => useTimeline(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.pendingCount).toBe(1);
    });

    act(() => {
      result.current.mergePending();
    });

    await waitFor(() => {
      expect(result.current.pendingCount).toBe(0);
      expect(result.current.pages.map((p) => p.postId)).toEqual(["01P2", "01P1"]);
    });
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
  });
});
