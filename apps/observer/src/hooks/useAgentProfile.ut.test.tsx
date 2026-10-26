// 単体テスト（NOUS-106）。観点表は docs/test/unit/NOUS-106/観点表_hooks.json
import { cleanup, act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  errorResponse,
  jsonResponse,
  makeClient,
  makePost,
  makeProfile,
  queryWrapper,
  stubFetch,
} from "../test/observerUt";
import { useAgentProfile } from "./useAgentProfile";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useAgentProfile（単体テスト）", () => {
  it("TC-UT_OWEB-038 agentId が空なら取りに行かず、読み込み中にもしない", async () => {
    const mock = stubFetch();

    const { result } = renderHook(() => useAgentProfile(""), { wrapper: queryWrapper(makeClient()) });

    expect(result.current).toMatchObject({ agent: undefined, posts: [], isLoading: false, hasNextPage: false });
    expect(mock).not.toHaveBeenCalled();
  });

  it("TC-UT_OWEB-039 過去投稿の先頭の取得の失敗は postsError に入れ、fetchNextPageError は null にする", async () => {
    stubFetch((url) => {
      if (url.endsWith("/posts?limit=30")) return errorResponse(500, "INTERNAL");
      if (url.startsWith("/api/agents/")) return jsonResponse(makeProfile());
      return undefined;
    });

    const { result } = renderHook(() => useAgentProfile("01A"), { wrapper: queryWrapper(makeClient()) });

    await waitFor(() => expect(result.current.postsError).toBeTruthy());
    expect(result.current.fetchNextPageError).toBeNull();
    expect(result.current.isFetchNextPageError).toBe(false);
  });

  it("TC-UT_OWEB-040 続きの取得の失敗は fetchNextPageError に入れ、postsError は null にする", async () => {
    stubFetch((url) => {
      if (url.includes("cursor=c1")) return errorResponse(500, "INTERNAL");
      if (url.endsWith("/posts?limit=30")) return jsonResponse({ items: [makePost("P1")], nextCursor: "c1" });
      if (url.startsWith("/api/agents/")) return jsonResponse(makeProfile());
      return undefined;
    });
    const { result } = renderHook(() => useAgentProfile("01A"), { wrapper: queryWrapper(makeClient()) });
    await waitFor(() => expect(result.current.hasNextPage).toBe(true));

    await act(async () => {
      await result.current.fetchNextPage();
    });

    await waitFor(() => expect(result.current.isFetchNextPageError).toBe(true));
    expect(result.current.fetchNextPageError).toBeTruthy();
    expect(result.current.postsError).toBeNull();
    expect(result.current.posts.map((p) => p.postId)).toEqual(["P1"]);
  });
});
