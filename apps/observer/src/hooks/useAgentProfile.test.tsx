import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as endpoints from "../api/endpoints";
import type { AgentPostsResponse, AgentProfileView, PostView } from "../api/types";
import { useAgentProfile } from "./useAgentProfile";

vi.mock("../api/endpoints", () => ({
  getAgentProfile: vi.fn(),
  getAgentPosts: vi.fn(),
}));

const sampleAgent: AgentProfileView = {
  agentId: "01A",
  handle: "minato",
  displayName: "ミナト",
  isAi: true,
  state: "active",
  bio: "港町のパン職人です",
  interests: "発酵、小麦",
  topics: "食文化",
  personality: "穏やか",
  valuesText: "丁寧な仕事",
  stance: "実践を重んじる",
  followingCount: 4,
  followerCount: 6,
  postCount: 2,
};

function makePost(postId: string, body: string): PostView {
  return {
    postId,
    body,
    worldTimeSec: 3600,
    agent: {
      agentId: "01A",
      handle: "minato",
      displayName: "ミナト",
      isAi: true,
      state: "active",
    },
    replyTo: null,
    replyCount: 0,
    likeCount: 1,
  };
}

function createWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useAgentProfile", () => {
  it("TC-NOUS68_DEV-01 プロフィールと先頭 30 件の過去投稿を取得し、続きを fetchNextPage で結合する", async () => {
    const page1: AgentPostsResponse = { items: [makePost("01P1", "1件目")], nextCursor: "CURSOR_2" };
    const page2: AgentPostsResponse = { items: [makePost("01P2", "2件目")], nextCursor: null };
    vi.mocked(endpoints.getAgentProfile).mockResolvedValue(sampleAgent);
    vi.mocked(endpoints.getAgentPosts).mockResolvedValueOnce(page1).mockResolvedValueOnce(page2);

    const { result } = renderHook(() => useAgentProfile("01A"), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.agent).toEqual(sampleAgent));
    await waitFor(() => expect(result.current.posts).toHaveLength(1));

    expect(endpoints.getAgentProfile).toHaveBeenCalledWith("01A");
    expect(endpoints.getAgentPosts).toHaveBeenCalledWith("01A", { cursor: undefined, limit: 30 });
    expect(result.current.hasNextPage).toBe(true);

    await act(async () => {
      await result.current.fetchNextPage();
    });

    await waitFor(() => expect(result.current.posts).toHaveLength(2));
    expect(endpoints.getAgentPosts).toHaveBeenLastCalledWith("01A", { cursor: "CURSOR_2", limit: 30 });
    expect(result.current.posts.map((p) => p.postId)).toEqual(["01P1", "01P2"]);
    expect(result.current.hasNextPage).toBe(false);
  });
});
