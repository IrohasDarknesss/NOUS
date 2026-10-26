// 単体テスト（NOUS-106）。観点表は docs/test/unit/NOUS-106/観点表_hooks.json
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ThreadView } from "../api/types";
import {
  advance,
  restoreRealTimers,
  calledUrls,
  jsonResponse,
  makeClient,
  makeNode,
  queryWrapper,
  setVisibility,
  stubFetch,
  useFakePollingTimers,
} from "../test/observerUt";
import { useThread } from "./useThread";

afterEach(() => {
  cleanup();
  restoreRealTimers();
  vi.unstubAllGlobals();
  setVisibility("visible");
});

const thread = (childIds: string[]): ThreadView => ({
  root: makeNode("R", { children: childIds.map((id) => makeNode(id)) }),
  focusPostId: "R",
});

describe("useThread（単体テスト）", () => {
  it("TC-UT_OWEB-035 スレッドは depth=5 で取り、postId が空なら取りに行かない", async () => {
    useFakePollingTimers();
    const mock = stubFetch((url) => (url.startsWith("/api/posts/") ? jsonResponse(thread([])) : undefined));
    renderHook(() => useThread("R"), { wrapper: queryWrapper(makeClient()) });
    renderHook(() => useThread(""), { wrapper: queryWrapper(makeClient()) });

    await advance();

    expect(calledUrls(mock, "/api/posts/")).toEqual(["/api/posts/R/thread?depth=5"]);
  });

  it("TC-UT_OWEB-036 最初の取得では newIds は空、再取得で増えた返信だけを newIds にし、999 ミリ秒では残り 1,000 ミリ秒で消す", async () => {
    useFakePollingTimers();
    let childIds = ["C1"];
    stubFetch((url) => (url.startsWith("/api/posts/") ? jsonResponse(thread(childIds)) : undefined));
    const { result } = renderHook(() => useThread("R"), { wrapper: queryWrapper(makeClient()) });
    await advance();
    const initial = new Set(result.current.newIds);
    childIds = ["C1", "C2"];
    await advance(30_000);
    const afterPoll = new Set(result.current.newIds);

    await advance(999);
    const at999 = new Set(result.current.newIds);
    await advance(1);

    expect(initial.size).toBe(0);
    expect([...afterPoll]).toEqual(["C2"]);
    expect([...at999]).toEqual(["C2"]);
    expect(result.current.newIds.size).toBe(0);
  });

  it("TC-UT_OWEB-037 postId が変わったら、新しいスレッドの返信を新しい返信として扱わない", async () => {
    useFakePollingTimers();
    stubFetch((url) => {
      if (url.startsWith("/api/posts/R/")) return jsonResponse(thread(["C1"]));
      if (url.startsWith("/api/posts/S/"))
        return jsonResponse({ root: makeNode("S", { children: [makeNode("D1")] }), focusPostId: "S" });
      return undefined;
    });
    const { result, rerender } = renderHook(({ id }) => useThread(id), {
      wrapper: queryWrapper(makeClient()),
      initialProps: { id: "R" },
    });
    await advance();

    rerender({ id: "S" });
    await advance();

    expect(result.current.thread?.root.postId).toBe("S");
    expect(result.current.newIds.size).toBe(0);
  });
});
