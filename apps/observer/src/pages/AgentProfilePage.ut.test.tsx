// 単体テスト（NOUS-106）。観点表は docs/test/unit/NOUS-106/観点表_P103_P104.json
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  errorResponse,
  jsonResponse,
  makePost,
  makeProfile,
  renderInLayout,
  stubFetch,
  type FetchHandler,
} from "../test/observerUt";
import { AgentProfilePage } from "./AgentProfilePage";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function profileHandler(opts: {
  profile?: () => Response;
  posts?: () => Response;
  more?: () => Response;
}): FetchHandler {
  return (url) => {
    if (!url.startsWith("/api/agents/")) return undefined;
    if (url.includes("cursor=")) return (opts.more ?? (() => jsonResponse({ items: [], nextCursor: null })))();
    if (url.includes("/posts"))
      return (opts.posts ?? (() => jsonResponse({ items: [makePost("P1")], nextCursor: null })))();
    return (opts.profile ?? (() => jsonResponse(makeProfile())))();
  };
}

const renderProfile = (agentId = "01A") =>
  renderInLayout(<AgentProfilePage />, { route: "/agents/:agentId", path: `/agents/${agentId}` });

describe("AgentProfilePage（単体テスト）", () => {
  it("TC-UT_P103-001 プロフィールの取得を待つ間は「読み込み中…」を出す", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => {})),
    );

    renderProfile();

    expect(screen.getByText("読み込み中…")).toBeInTheDocument();
  });

  it("TC-UT_P103-002 過去投稿が 0 件なら「まだ投稿はありません」を出す", async () => {
    stubFetch(profileHandler({ posts: () => jsonResponse({ items: [], nextCursor: null }) }));

    renderProfile();

    expect(await screen.findByText("まだ投稿はありません")).toBeInTheDocument();
  });

  it("TC-UT_P103-003 フォロー中・フォロワーの数は agentId をエンコードした P104 へのリンクにし、投稿の数はリンクにしない", async () => {
    stubFetch(profileHandler({ profile: () => jsonResponse(makeProfile({ agentId: "a/b" })) }));

    renderProfile("a%2Fb");

    expect(await screen.findByRole("link", { name: "フォロー中 2" })).toHaveAttribute(
      "href",
      "/agents/a%2Fb/follows?type=following",
    );
    expect(screen.getByRole("link", { name: "フォロワー 3" })).toHaveAttribute(
      "href",
      "/agents/a%2Fb/follows?type=followers",
    );
    expect(screen.getByText("投稿 4").closest("a")).toBeNull();
  });

  it("TC-UT_P103-004 続きの取得の失敗のバナーは、もう一度押して成功したら消す", async () => {
    let fail = true;
    stubFetch(
      profileHandler({
        posts: () => jsonResponse({ items: [makePost("P1")], nextCursor: "c1" }),
        more: () =>
          fail ? errorResponse(500, "INTERNAL") : jsonResponse({ items: [makePost("P0")], nextCursor: null }),
      }),
    );
    renderProfile();
    fireEvent.click(await screen.findByRole("button", { name: "さらに読み込む" }));
    await screen.findByRole("alert");
    fail = false;

    fireEvent.click(screen.getByRole("button", { name: "さらに読み込む" }));

    expect(await screen.findByText("本文 P0")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("TC-UT_P103-005 プロフィールは取れて過去投稿の取得が 500 なら「プロフィールを読み込めませんでした」を出す", async () => {
    stubFetch(profileHandler({ posts: () => errorResponse(500, "INTERNAL") }));

    renderProfile();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "プロフィールを読み込めませんでした。時間をおいて再読み込みしてください",
    );
    expect(screen.getByRole("heading", { name: "ミカ" })).toBeInTheDocument();
  });
});
