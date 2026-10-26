// 単体テスト（NOUS-106）。観点表は docs/test/unit/NOUS-106/観点表_P101_P102.json
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ThreadNode, ThreadView } from "../api/types";
import {
  advance,
  calledUrls,
  errorResponse,
  jsonResponse,
  makeNode,
  renderInLayout,
  restoreRealTimers,
  stubFetch,
  useFakePollingTimers,
  type FetchHandler,
} from "../test/observerUt";
import { ThreadPage } from "./ThreadPage";

const scrollIntoView = vi.fn();

beforeEach(() => {
  scrollIntoView.mockReset();
  Element.prototype.scrollIntoView = scrollIntoView;
});

afterEach(() => {
  cleanup();
  restoreRealTimers();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "");
});

const view = (root: ThreadNode, focusPostId = root.postId): ThreadView => ({ root, focusPostId });

function threadHandler(main: () => Response, more?: () => Response): FetchHandler {
  return (url) => {
    if (!url.startsWith("/api/posts/")) return undefined;
    if (url.includes("from=") && more) return more();
    return main();
  };
}

const renderThread = (postId = "R", history: string[] = []) =>
  renderInLayout(<ThreadPage />, { route: "/posts/:postId", path: `/posts/${postId}`, history });
const location = () => screen.getByTestId("location").textContent;

/** depth 段の深さまで 1 本の返信の鎖を作る */
function chain(depth: number): ThreadNode {
  let node = makeNode(`D${depth}`);
  for (let d = depth - 1; d >= 0; d--) node = makeNode(`D${d}`, { children: [node] });
  return node;
}

describe("ThreadPage（単体テスト）", () => {
  it("TC-UT_P102-001 スレッドを depth=5 で取り、開いた投稿の要素を画面の中央へスクロールする", async () => {
    const mock = stubFetch(
      threadHandler(() => jsonResponse(view(makeNode("R", { children: [makeNode("C1")] }), "C1"))),
    );

    renderThread("C1");

    await screen.findByText("本文 C1");
    expect(calledUrls(mock, "/api/posts/")).toEqual(["/api/posts/C1/thread?depth=5"]);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "center" });
    expect(scrollIntoView.mock.contexts[0]).toHaveAttribute("data-post-id", "C1");
  });

  it("TC-UT_P102-002 「タイムラインへ戻る」は履歴が無ければ / へ移る", async () => {
    stubFetch(threadHandler(() => jsonResponse(view(makeNode("R")))));
    renderThread();

    fireEvent.click(await screen.findByRole("link", { name: "← タイムラインへ戻る" }));

    expect(location()).toBe("/");
  });

  it("TC-UT_P102-003 「タイムラインへ戻る」は履歴があれば一つ前の画面へ戻る", async () => {
    stubFetch(threadHandler(() => jsonResponse(view(makeNode("R")))));
    window.history.replaceState({ idx: 1 }, "");
    renderThread("R", ["/agents/01A"]);

    fireEvent.click(await screen.findByRole("link", { name: "← タイムラインへ戻る" }));

    expect(location()).toBe("/agents/01A");
  });

  it("TC-UT_P102-004 スレッドの取得が 500 なら「スレッドを読み込めませんでした」を出す", async () => {
    stubFetch(threadHandler(() => errorResponse(500, "INTERNAL")));

    renderThread();

    expect(await screen.findByRole("alert")).toHaveTextContent("スレッドを読み込めませんでした");
  });

  it("TC-UT_P102-005 再取得が 2 回続けて失敗してもバナーは出さず、3 回続けて失敗したら「最新の返信を取得できていません」を出す", async () => {
    useFakePollingTimers();
    let fail = false;
    stubFetch(threadHandler(() => (fail ? errorResponse(500, "INTERNAL") : jsonResponse(view(makeNode("R"))))));
    renderThread();
    await advance();
    fail = true;
    await advance(30_000);
    await advance(30_000);
    const afterTwo = screen.queryByRole("alert");

    await advance(30_000);

    expect(afterTwo).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent("最新の返信を取得できていません");
    expect(screen.getByText("本文 R")).toBeInTheDocument();
  });

  it("TC-UT_P102-006 再取得で増えた返信は 1 秒だけ背景を黄色にする", async () => {
    useFakePollingTimers();
    let children = [makeNode("C1")];
    stubFetch(threadHandler(() => jsonResponse(view(makeNode("R", { children })))));
    renderThread();
    await advance();
    children = [makeNode("C1"), makeNode("C2")];
    await advance(30_000);
    const card = () => document.querySelector('[data-post-id="C2"]') as HTMLElement;
    const during = card().style.background;

    await advance(1_000);

    expect(during).toBe("rgb(254, 249, 195)");
    expect(card().style.background).not.toBe("rgb(254, 249, 195)");
    expect((document.querySelector('[data-post-id="C1"]') as HTMLElement).style.background).not.toBe(
      "rgb(254, 249, 195)",
    );
  });

  it("TC-UT_P102-007 「続きを表示」の取得に失敗したら「続きを読み込めませんでした」を出し、ボタンは押せる状態のまま残す", async () => {
    stubFetch(
      threadHandler(
        () => jsonResponse(view(makeNode("R", { moreCount: 2 }))),
        () => errorResponse(500, "INTERNAL"),
      ),
    );
    renderThread();

    fireEvent.click(await screen.findByRole("button", { name: "続きを表示（2 件）" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("続きを読み込めませんでした");
    expect(screen.getByRole("button", { name: "続きを表示（2 件）" })).toBeEnabled();
  });

  it("TC-UT_P102-008 「続きを表示」は読み込み中にもう一度押しても 1 回しか取りに行かない", async () => {
    let resolveMore: (res: Response) => void = () => {};
    const mock = stubFetch(
      threadHandler(
        () => jsonResponse(view(makeNode("R", { moreCount: 1 }))),
        () => undefined as unknown as Response,
      ),
    );
    mock.mockImplementation((input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("from=")) return new Promise<Response>((resolve) => (resolveMore = resolve));
      if (url.startsWith("/api/posts/")) return Promise.resolve(jsonResponse(view(makeNode("R", { moreCount: 1 }))));
      return Promise.resolve(jsonResponse({ state: "running", worldTimeSec: 0, isRunning: true, updatedAt: "" }));
    });
    renderThread();
    const button = await screen.findByRole("button", { name: "続きを表示（1 件）" });

    fireEvent.click(button);
    fireEvent.click(button);

    expect(calledUrls(mock, "/api/posts/").filter((u) => u.includes("from="))).toHaveLength(1);
    expect(button).toBeDisabled();
    resolveMore(jsonResponse(view(makeNode("X"))));
  });

  it("TC-UT_P102-009 「続きを表示」は開いた投稿の ID で、from に省略された投稿の ID と depth=5 を付けて取る", async () => {
    const mock = stubFetch(
      threadHandler(
        () => jsonResponse(view(makeNode("R", { children: [makeNode("C1", { moreCount: 1 })] }), "C1")),
        () => jsonResponse(view(makeNode("C1", { children: [makeNode("G1")] }), "C1")),
      ),
    );
    renderThread("C1");

    fireEvent.click(await screen.findByRole("button", { name: "続きを表示（1 件）" }));

    expect(await screen.findByText("本文 G1")).toBeInTheDocument();
    expect(calledUrls(mock, "/api/posts/").filter((u) => u.includes("from="))).toEqual([
      "/api/posts/C1/thread?depth=5&from=C1",
    ]);
  });

  it.each([
    { depth: 4, px: "64px" },
    { depth: 5, px: "80px" },
    { depth: 6, px: "80px" },
  ])(
    "TC-UT_P102-010 左の余白は 1 段ごとに 16px 増やし、5 段より深くても 80px で止める（深さ $depth）",
    async ({ depth, px }) => {
      stubFetch(threadHandler(() => jsonResponse(view(chain(6), "D0"))));
      renderThread("D0");

      await screen.findByText("本文 D6");

      expect((document.querySelector(`[data-post-id="D${depth}"]`) as HTMLElement).style.marginLeft).toBe(px);
    },
  );

  it.each([
    { label: "agent が null", node: makeNode("C1", { agent: null }) },
    { label: "body が null", node: makeNode("C1", { body: null }) },
  ])(
    "TC-UT_P102-011 hidden が false でも、agent か body が無い投稿は「管理者が非表示にした投稿」にする（$label）",
    async ({ node }) => {
      stubFetch(threadHandler(() => jsonResponse(view(makeNode("R", { children: [node] })))));

      renderThread();

      expect(await screen.findByText("管理者が非表示にした投稿")).toBeInTheDocument();
    },
  );

  it("TC-UT_P102-012 「続きを表示」で返信が 0 件だったら、ボタンを消して何も足さない", async () => {
    stubFetch(
      threadHandler(
        () => jsonResponse(view(makeNode("R", { moreCount: 1 }))),
        () => jsonResponse(view(makeNode("R"))),
      ),
    );
    renderThread();

    fireEvent.click(await screen.findByRole("button", { name: "続きを表示（1 件）" }));

    await vi.waitFor(() => expect(screen.queryByRole("button", { name: /続きを表示/ })).not.toBeInTheDocument());
    expect(document.querySelectorAll("[data-post-id]")).toHaveLength(1);
  });

  it("TC-UT_P102-013 最初の取得に失敗しても、次の自動の再取得で成功したらスレッドを出してバナーを消す", async () => {
    useFakePollingTimers();
    let fail = true;
    stubFetch(threadHandler(() => (fail ? errorResponse(500, "INTERNAL") : jsonResponse(view(makeNode("R"))))));
    renderThread();
    await advance();
    const withBanner = screen.queryByRole("alert");
    fail = false;

    await advance(30_000);

    expect(withBanner).toHaveTextContent("スレッドを読み込めませんでした");
    expect(screen.getByText("本文 R")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("TC-UT_P102-014 「最新の返信を取得できていません」は、次の再取得に成功したら消す", async () => {
    useFakePollingTimers();
    let fail = false;
    stubFetch(threadHandler(() => (fail ? errorResponse(500, "INTERNAL") : jsonResponse(view(makeNode("R"))))));
    renderThread();
    await advance();
    fail = true;
    await advance(30_000);
    await advance(30_000);
    await advance(30_000);
    const withBanner = screen.queryByRole("alert");
    fail = false;

    await advance(30_000);

    expect(withBanner).toHaveTextContent("最新の返信を取得できていません");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
