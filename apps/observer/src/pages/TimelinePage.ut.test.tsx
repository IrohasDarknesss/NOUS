// 単体テスト（NOUS-106）。観点表は docs/test/unit/NOUS-106/観点表_P101_P102.json
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TIMELINE_SCROLL_KEY } from "../lib/scrollRestore";
import {
  advance,
  calledUrls,
  errorResponse,
  jsonResponse,
  makePost,
  makeTimelinePage,
  renderInLayout,
  restoreRealTimers,
  setVisibility,
  stubFetch,
  useFakePollingTimers,
  type FetchHandler,
} from "../test/observerUt";
import { TimelinePage } from "./TimelinePage";

afterEach(() => {
  cleanup();
  restoreRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.sessionStorage.clear();
  setVisibility("visible");
});

const renderTimeline = () => renderInLayout(<TimelinePage />, { route: "/", path: "/" });
const location = () => screen.getByTestId("location").textContent;

/** 先頭の一覧・続き・新しい投稿の応答を決める */
function timelineHandler(opts: { head?: () => Response; next?: () => Response; since?: () => Response }): FetchHandler {
  return (url) => {
    if (!url.startsWith("/api/timeline")) return undefined;
    if (url.includes("since=")) return (opts.since ?? (() => jsonResponse(makeTimelinePage([]))))();
    if (url.includes("cursor=")) return (opts.next ?? (() => jsonResponse(makeTimelinePage([]))))();
    return (opts.head ?? (() => jsonResponse(makeTimelinePage([makePost("P9")]))))();
  };
}

describe("TimelinePage（単体テスト）", () => {
  it("TC-UT_P101-001 最初の取得に成功したら、保存したスクロール位置に一度だけ戻す", async () => {
    window.sessionStorage.setItem(TIMELINE_SCROLL_KEY, "420");
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    stubFetch(timelineHandler({}));

    renderTimeline();

    await screen.findByText("本文 P9");
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith(0, 420);
  });

  it("TC-UT_P101-002 投稿カードを押すとスクロール位置を保存して、その投稿のスレッドへ移る", async () => {
    Object.defineProperty(window, "scrollY", { configurable: true, value: 300 });
    stubFetch(timelineHandler({}));
    renderTimeline();

    fireEvent.click(await screen.findByText("本文 P9"));

    expect(window.sessionStorage.getItem(TIMELINE_SCROLL_KEY)).toBe("300");
    expect(location()).toBe("/posts/P9");
  });

  it("TC-UT_P101-003 表示名を押すとプロフィールへ移り、スレッドへは移らない", async () => {
    stubFetch(timelineHandler({}));
    renderTimeline();

    fireEvent.click(await screen.findByRole("link", { name: "ミカ" }));

    expect(location()).toBe("/agents/01A");
  });

  it("TC-UT_P101-004 さらに読み込むで続きを cursor 付きで取って末尾に足し、nextCursor が無くなればボタンを隠す", async () => {
    const mock = stubFetch(
      timelineHandler({
        head: () => jsonResponse(makeTimelinePage([makePost("P9")], "c1")),
        next: () => jsonResponse(makeTimelinePage([makePost("P1")], null)),
      }),
    );
    renderTimeline();

    fireEvent.click(await screen.findByRole("button", { name: "さらに読み込む" }));

    expect(await screen.findByText("本文 P1")).toBeInTheDocument();
    expect(calledUrls(mock, "/api/timeline?cursor=")).toEqual(["/api/timeline?cursor=c1&limit=30"]);
    expect(screen.queryByRole("button", { name: "さらに読み込む" })).not.toBeInTheDocument();
  });

  it("TC-UT_P101-005 続きの取得に失敗したら「続きを読み込めませんでした」を出し、ボタンは押せる状態に戻す", async () => {
    stubFetch(
      timelineHandler({
        head: () => jsonResponse(makeTimelinePage([makePost("P9")], "c1")),
        next: () => errorResponse(500, "INTERNAL"),
      }),
    );
    renderTimeline();

    fireEvent.click(await screen.findByRole("button", { name: "さらに読み込む" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("続きを読み込めませんでした");
    expect(screen.getByRole("button", { name: "さらに読み込む" })).toBeEnabled();
  });

  it("TC-UT_P101-006 30 秒ごとの取得で新しい投稿があれば件数を出し、押すと先頭に差し込んで件数を消し、先頭へスクロールする", async () => {
    useFakePollingTimers();
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    let pending = makeTimelinePage([]);
    stubFetch(timelineHandler({ since: () => jsonResponse(pending) }));
    renderTimeline();
    await advance();
    pending = makeTimelinePage([makePost("P10")]);
    await advance(30_000);

    act(() => screen.getByRole("button", { name: "新しい投稿 1 件" }).click());
    await advance();

    const bodies = screen.getAllByText(/^本文 P/).map((el) => el.textContent);
    expect(bodies).toEqual(["本文 P10", "本文 P9"]);
    expect(screen.queryByRole("button", { name: /新しい投稿/ })).not.toBeInTheDocument();
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it("TC-UT_P101-007 新しい投稿の取得が 2 回続けて失敗してもバナーは出さず、3 回続けて失敗したら「最新の投稿を取得できていません」を出す", async () => {
    useFakePollingTimers();
    stubFetch(timelineHandler({ since: () => errorResponse(500, "INTERNAL") }));
    renderTimeline();
    await advance();
    await advance(30_000);
    const afterTwo = screen.queryByRole("alert");

    await advance(30_000);

    expect(afterTwo).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent("最新の投稿を取得できていません");
  });

  it("TC-UT_P101-008 「最新の投稿を取得できていません」は、次の取得に成功したら消す", async () => {
    useFakePollingTimers();
    let fail = true;
    stubFetch(
      timelineHandler({
        since: () => (fail ? errorResponse(500, "INTERNAL") : jsonResponse(makeTimelinePage([]))),
      }),
    );
    renderTimeline();
    await advance();
    await advance(30_000);
    await advance(30_000);
    const withBanner = screen.queryByRole("alert");
    fail = false;

    await advance(30_000);

    expect(withBanner).not.toBeNull();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("TC-UT_P101-009 画面が隠れている間は 30 秒ごとの取得をしない", async () => {
    useFakePollingTimers();
    const mock = stubFetch(timelineHandler({}));
    renderTimeline();
    await advance();
    const before = calledUrls(mock, "/api/timeline").length;

    act(() => setVisibility("hidden"));
    await advance(90_000);

    expect(calledUrls(mock, "/api/timeline")).toHaveLength(before);
  });

  it("TC-UT_P101-010 最初の取得に失敗しても、次の自動の再取得で成功したら一覧を出してバナーを消す", async () => {
    useFakePollingTimers();
    let fail = true;
    stubFetch(
      timelineHandler({
        head: () => (fail ? errorResponse(500, "INTERNAL") : jsonResponse(makeTimelinePage([makePost("P9")]))),
      }),
    );
    renderTimeline();
    await advance();
    const withBanner = screen.queryByRole("alert");
    fail = false;

    await advance(30_000);

    expect(withBanner).toHaveTextContent("投稿を読み込めませんでした。時間をおいて再読み込みしてください");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("本文 P9")).toBeInTheDocument();
  });

  it("TC-UT_P101-011 0 件のときも 30 秒ごとに取得し、新しい投稿があれば件数を出す", async () => {
    useFakePollingTimers();
    let posts = makeTimelinePage([]);
    stubFetch(timelineHandler({ head: () => jsonResponse(posts), since: () => jsonResponse(posts) }));
    renderTimeline();
    await advance();
    posts = makeTimelinePage([makePost("P1")]);

    await advance(30_000);

    expect(screen.getByRole("button", { name: "新しい投稿 1 件" })).toBeInTheDocument();
  });
});
