// 単体テスト（NOUS-106）。観点表は docs/test/unit/NOUS-106/観点表_layout_components.json
import { cleanup, act, render, renderHook, screen } from "@testing-library/react";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, NetworkError, NotInvitedError } from "../api/client";
import {
  errorResponse,
  jsonResponse,
  makeClient,
  restoreRealTimers,
  stubFetch,
  useFakePollingTimers,
  advance,
  WORLD_RUNNING,
} from "../test/observerUt";
import { ErrorBanner } from "./ErrorBanner";
import { ObserverLayout, useBanner, type ApiErrorMessages } from "./ObserverLayout";

afterEach(() => {
  cleanup();
  restoreRealTimers();
  vi.unstubAllGlobals();
});

/** 「報告する」を押すと error を reportApiError に渡す子（描画の直後はレイアウトがバナーを消すため、押して渡す） */
function Reporter({ error, messages }: { error: unknown; messages: ApiErrorMessages }) {
  const { reportApiError } = useBanner();
  return (
    <div>
      <p>子の内容</p>
      <button type="button" onClick={() => reportApiError(error, messages)}>
        報告する
      </button>
      <Link to="/other">別の画面へ</Link>
    </div>
  );
}

function renderReporter(error: unknown, messages: ApiErrorMessages = { banner: "読み込めませんでした" }) {
  stubFetch();
  const result = render(
    <QueryClientProvider client={makeClient()}>
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route
            path="/"
            element={
              <ObserverLayout>
                <Reporter error={error} messages={messages} />
              </ObserverLayout>
            }
          />
          <Route
            path="/other"
            element={
              <ObserverLayout>
                <p>別の画面</p>
              </ObserverLayout>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  act(() => screen.getByRole("button", { name: "報告する" }).click());
  return result;
}

function renderFooter() {
  return render(
    <QueryClientProvider client={makeClient()}>
      <MemoryRouter>
        <ObserverLayout>
          <p>中身</p>
        </ObserverLayout>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("layout（単体テスト）", () => {
  it("TC-UT_OWEB-043 useBanner を ObserverLayout の外で使うと例外になる", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => renderHook(() => useBanner())).toThrow("useBanner は ObserverLayout の中で使う");
  });

  it("TC-UT_OWEB-044 NotInvitedError を渡されても、バナーも全画面の表示も出さない", () => {
    renderReporter(new NotInvitedError());

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("子の内容")).toBeInTheDocument();
  });

  it("TC-UT_OWEB-045 404 で notFound の文言が無ければ「ページが見つかりません」の全画面表示にし、子は出さない", () => {
    renderReporter(new ApiError(404, "POST_NOT_FOUND", "not found"));

    expect(screen.getByRole("heading", { name: "ページが見つかりません" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "タイムラインへ" })).toHaveAttribute("href", "/");
    expect(screen.queryByText("子の内容")).not.toBeInTheDocument();
  });

  it("TC-UT_OWEB-046 通信エラーは画面ごとの文言の赤色バーにし、子はそのまま出す", () => {
    renderReporter(new NetworkError(new TypeError("x")), { banner: "投稿を読み込めませんでした" });

    expect(screen.getByRole("alert")).toHaveTextContent("投稿を読み込めませんでした");
    expect(screen.getByText("子の内容")).toBeInTheDocument();
  });

  it("TC-UT_OWEB-047 別の画面へ移ると、前の画面のバナーを消す", async () => {
    renderReporter(new NetworkError(new TypeError("x")));
    expect(screen.getByRole("alert")).toBeInTheDocument();

    act(() => screen.getByRole("link", { name: "別の画面へ" }).click());

    expect(await screen.findByText("別の画面")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("TC-UT_OWEB-048 403 は様式③の「このネットワークからは閲覧できません」の全画面表示にする", () => {
    renderReporter(new ApiError(403, null, "forbidden"));

    expect(screen.getByRole("heading", { name: "このネットワークからは閲覧できません" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("TC-UT_OWEB-049 ErrorBanner は message が null なら何も描かず、文字列なら role=alert で出す", () => {
    const { container, rerender } = render(<ErrorBanner message={null} />);
    const empty = container.innerHTML;

    rerender(<ErrorBanner message="最新の投稿を取得できていません" />);

    expect(empty).toBe("");
    expect(screen.getByRole("alert")).toHaveTextContent("最新の投稿を取得できていません");
  });

  it.each(["paused", "limit_stopped", "emergency_stopped", "preparing"] as const)(
    "TC-UT_OWEB-050 フッターは running 以外の状態では「現在、世界は止まっています」を出す（%s）",
    async (state) => {
      stubFetch((url) =>
        url.startsWith("/api/world") ? jsonResponse({ ...WORLD_RUNNING, state, isRunning: false }) : undefined,
      );

      renderFooter();

      expect(await screen.findByText("現在、世界は止まっています")).toBeInTheDocument();
    },
  );

  it("TC-UT_OWEB-051 フッターは取得に失敗したら「状態を取得できません」を出し、最終更新は出さない", async () => {
    stubFetch((url) => (url.startsWith("/api/world") ? errorResponse(500, "INTERNAL") : undefined));

    renderFooter();

    expect(await screen.findByText("状態を取得できません")).toBeInTheDocument();
    expect(screen.queryByText(/最終更新/)).not.toBeInTheDocument();
  });

  it("TC-UT_OWEB-052 フッターは取得の前は「状態を取得しています」を出し、最終更新は出さない", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => {})),
    );

    renderFooter();

    expect(screen.getByText("状態を取得しています")).toBeInTheDocument();
    expect(screen.queryByText(/最終更新/)).not.toBeInTheDocument();
  });

  it("TC-UT_OWEB-053 フッターの最終更新は、取得に成功した端末の時刻を JST の HH:MM で出す", async () => {
    useFakePollingTimers("2026-10-22T05:21:00.000Z");
    stubFetch();
    renderFooter();

    await advance();

    expect(screen.getByText("最終更新 14:21")).toBeInTheDocument();
    expect(screen.getByText("世界は動いています")).toBeInTheDocument();
  });
});
