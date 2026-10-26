// 単体テスト（NOUS-106）。観点表は docs/test/unit/NOUS-106/観点表_hooks.json
import { cleanup, act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  advance,
  restoreRealTimers,
  calledUrls,
  jsonResponse,
  makeClient,
  makePost,
  makeTimelinePage,
  queryWrapper,
  setVisibility,
  stubFetch,
  useFakePollingTimers,
} from "../test/observerUt";
import { useTimeline } from "./useTimeline";

afterEach(() => {
  cleanup();
  restoreRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setVisibility("visible");
});

describe("useTimeline（単体テスト）", () => {
  it("TC-UT_OWEB-029 先頭は limit=30 で取り、nextCursor があれば続きを cursor 付きで取り、無ければ hasNextPage を false にする", async () => {
    const mock = stubFetch((url) => {
      if (url === "/api/timeline?limit=30") return jsonResponse(makeTimelinePage([makePost("P2")], "c1"));
      if (url === "/api/timeline?cursor=c1&limit=30") return jsonResponse(makeTimelinePage([makePost("P1")], null));
      if (url.includes("since=")) return jsonResponse(makeTimelinePage([]));
      return undefined;
    });
    const { result } = renderHook(() => useTimeline(), { wrapper: queryWrapper(makeClient()) });
    await waitFor(() => expect(result.current.hasNextPage).toBe(true));

    await act(async () => {
      await result.current.fetchNextPage();
    });

    await waitFor(() => expect(result.current.pages).toHaveLength(2));
    expect(calledUrls(mock, "/api/timeline?cursor=")).toEqual(["/api/timeline?cursor=c1&limit=30"]);
    expect(result.current.pages.map((p) => p.postId)).toEqual(["P2", "P1"]);
    expect(result.current.hasNextPage).toBe(false);
  });

  it("TC-UT_OWEB-030 一覧が 0 件のときは新しい投稿の取得（since）をしない", async () => {
    useFakePollingTimers();
    const mock = stubFetch((url) => (url.startsWith("/api/timeline") ? jsonResponse(makeTimelinePage([])) : undefined));
    renderHook(() => useTimeline(), { wrapper: queryWrapper(makeClient()) });

    await advance();
    await advance(60_000);

    expect(calledUrls(mock, "/api/timeline").filter((u) => u.includes("since="))).toHaveLength(0);
  });

  it("TC-UT_OWEB-031 新しい投稿は先頭の postId を since にして limit=30 で取り、前面のとき 30 秒ごとに取り直す", async () => {
    useFakePollingTimers();
    const mock = stubFetch((url) => {
      if (url.includes("since=")) return jsonResponse(makeTimelinePage([]));
      if (url.startsWith("/api/timeline")) return jsonResponse(makeTimelinePage([makePost("P9"), makePost("P8")]));
      return undefined;
    });
    renderHook(() => useTimeline(), { wrapper: queryWrapper(makeClient()) });
    await advance();
    const sinceUrls = () => calledUrls(mock, "/api/timeline").filter((u) => u.includes("since="));
    const first = sinceUrls();

    await advance(30_000);

    expect(first).toEqual(["/api/timeline?limit=30&since=P9"]);
    expect(sinceUrls()).toHaveLength(2);
  });

  it("TC-UT_OWEB-032 pendingCount は新しい投稿の中で同じ postId が重なっても 1 件と数える", async () => {
    stubFetch((url) => {
      if (url.includes("since="))
        return jsonResponse(makeTimelinePage([makePost("P11"), makePost("P11"), makePost("P10")]));
      if (url.startsWith("/api/timeline")) return jsonResponse(makeTimelinePage([makePost("P9")]));
      return undefined;
    });

    const { result } = renderHook(() => useTimeline(), { wrapper: queryWrapper(makeClient()) });

    await waitFor(() => expect(result.current.pendingCount).toBe(2));
  });

  it("TC-UT_OWEB-033 新しい投稿が無いとき mergePending は一覧を変えず、先頭へスクロールする", async () => {
    stubFetch((url) => {
      if (url.includes("since=")) return jsonResponse(makeTimelinePage([]));
      if (url.startsWith("/api/timeline")) return jsonResponse(makeTimelinePage([makePost("P9")]));
      return undefined;
    });
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const { result } = renderHook(() => useTimeline(), { wrapper: queryWrapper(makeClient()) });
    await waitFor(() => expect(result.current.pages).toHaveLength(1));
    const before = result.current.pages;

    act(() => result.current.mergePending());

    expect(result.current.pages).toBe(before);
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it("TC-UT_OWEB-034 mergePending は 2 ページ目以降を変えず、1 ページ目の先頭にだけ足す", async () => {
    stubFetch((url) => {
      if (url.includes("since=")) return jsonResponse(makeTimelinePage([makePost("P10")]));
      if (url === "/api/timeline?limit=30") return jsonResponse(makeTimelinePage([makePost("P9")], "c1"));
      if (url.startsWith("/api/timeline?cursor=c1")) return jsonResponse(makeTimelinePage([makePost("P1")]));
      return undefined;
    });
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const { result } = renderHook(() => useTimeline(), { wrapper: queryWrapper(makeClient()) });
    await waitFor(() => expect(result.current.hasNextPage).toBe(true));
    await act(async () => {
      await result.current.fetchNextPage();
    });
    await waitFor(() => expect(result.current.pages).toHaveLength(2));
    await waitFor(() => expect(result.current.pendingCount).toBe(1));

    act(() => result.current.mergePending());

    await waitFor(() => expect(result.current.pages.map((p) => p.postId)).toEqual(["P10", "P9", "P1"]));
    expect(result.current.pendingCount).toBe(0);
  });

  it("TC-UT_OWEB-064 一覧も新しい投稿もまだ無いときに mergePending を呼んでも、例外を出さずに先頭へスクロールだけする", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => {})),
    );
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const { result } = renderHook(() => useTimeline(), { wrapper: queryWrapper(makeClient()) });

    act(() => result.current.mergePending());

    expect(result.current.pages).toEqual([]);
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
  });
});
