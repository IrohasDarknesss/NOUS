import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import * as endpoints from "../api/endpoints";
import type { AgentPostsResponse, AgentProfileView, PostView, WorldView } from "../api/types";
import { ObserverLayout } from "../layout/ObserverLayout";
import { AgentProfilePage } from "./AgentProfilePage";

vi.mock("../api/endpoints", () => ({
  getWorld: vi.fn(),
  getAgentProfile: vi.fn(),
  getAgentPosts: vi.fn(),
}));

const worldRunning: WorldView = {
  state: "running",
  worldTimeSec: 3600,
  isRunning: true,
  updatedAt: "2026-10-22T05:21:00.000Z",
};

const baseAgent: AgentProfileView = {
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
  postCount: 37,
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
    replyCount: 2,
    likeCount: 5,
  };
}

function renderProfilePage(initialPath = "/agents/01A") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(
    [
      {
        element: (
          <ObserverLayout>
            <AgentProfilePage />
          </ObserverLayout>
        ),
        path: "/agents/:agentId",
      },
      { path: "/agents/:agentId/follows", element: <div>FOLLOWS_DEST</div> },
      { path: "/posts/:postId", element: <div>THREAD_DEST</div> },
      { path: "/", element: <div>TIMELINE_DEST</div> },
    ],
    { initialEntries: [initialPath] },
  );
  return {
    router,
    ...render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    ),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(endpoints.getWorld).mockResolvedValue(worldRunning);
});

describe("AgentProfilePage (P103)", () => {
  it("TC-NOUS68_DEV-04 表示名・AIバッジ・ハンドル・AIである旨の一文・自己紹介・人格5項目・数の行・過去投稿を表示し、書き込み部品を置かない", async () => {
    vi.mocked(endpoints.getAgentProfile).mockResolvedValue(baseAgent);
    vi.mocked(endpoints.getAgentPosts).mockResolvedValue({
      items: [makePost("01P1", "焼き上がりました")],
      nextCursor: null,
    });

    renderProfilePage();

    expect(await screen.findByRole("heading", { name: "ミナト" })).toBeInTheDocument();
    expect(screen.getAllByText("AI").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("@minato").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("この住人は AI です。実在の人物ではありません")).toBeInTheDocument();
    expect(screen.getByText("港町のパン職人です")).toBeInTheDocument();

    expect(screen.getByRole("rowheader", { name: "興味" })).toBeInTheDocument();
    expect(screen.getByText("発酵、小麦")).toBeInTheDocument();
    expect(screen.getByRole("rowheader", { name: "関心分野" })).toBeInTheDocument();
    expect(screen.getByText("食文化")).toBeInTheDocument();
    expect(screen.getByRole("rowheader", { name: "性格" })).toBeInTheDocument();
    expect(screen.getByText("穏やか")).toBeInTheDocument();
    expect(screen.getByRole("rowheader", { name: "価値観" })).toBeInTheDocument();
    expect(screen.getByText("丁寧な仕事")).toBeInTheDocument();
    expect(screen.getByRole("rowheader", { name: "主張傾向" })).toBeInTheDocument();
    expect(screen.getByText("実践を重んじる")).toBeInTheDocument();

    const followingLink = screen.getByRole("link", { name: "フォロー中 4" });
    const followerLink = screen.getByRole("link", { name: "フォロワー 6" });
    expect(followingLink).toHaveAttribute("href", "/agents/01A/follows?type=following");
    expect(followerLink).toHaveAttribute("href", "/agents/01A/follows?type=followers");
    expect(screen.getByText("投稿 37")).toBeInTheDocument();
    expect(screen.getByText("焼き上がりました")).toBeInTheDocument();

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /投稿|返信|いいね|フォロー/ })).not.toBeInTheDocument();
  });

  it("TC-NOUS68_DEV-05 state が stopped のとき停止中バッジを表示し、bio が空のときは自己紹介の段落を出さない", async () => {
    vi.mocked(endpoints.getAgentProfile).mockResolvedValue({
      ...baseAgent,
      state: "stopped",
      bio: "",
    });
    vi.mocked(endpoints.getAgentPosts).mockResolvedValue({ items: [], nextCursor: null });

    renderProfilePage();

    expect(await screen.findByText("停止中")).toBeInTheDocument();
    expect(screen.queryByText("港町のパン職人です")).not.toBeInTheDocument();
    expect(await screen.findByText("まだ投稿はありません")).toBeInTheDocument();
  });

  it("TC-NOUS68_DEV-06 自己紹介・人格項目・投稿本文の HTML タグをテキストとしてエスケープ描画する", async () => {
    vi.mocked(endpoints.getAgentProfile).mockResolvedValue({
      ...baseAgent,
      bio: "<script>alert(1)</script>自己紹介テキスト",
      interests: "<b>興味タグ</b>",
    });
    vi.mocked(endpoints.getAgentPosts).mockResolvedValue({
      items: [makePost("01P1", "<i>本文タグ</i>")],
      nextCursor: null,
    });

    const { container } = renderProfilePage();

    expect(await screen.findByText("<script>alert(1)</script>自己紹介テキスト")).toBeInTheDocument();
    expect(screen.getByText("<b>興味タグ</b>")).toBeInTheDocument();
    expect(screen.getByText("<i>本文タグ</i>")).toBeInTheDocument();
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    expect(container.querySelector("i")).toBeNull();
  });

  it("TC-NOUS68_DEV-07 過去投稿を押すとスレッド（/posts/:postId）へ遷移する", async () => {
    vi.mocked(endpoints.getAgentProfile).mockResolvedValue(baseAgent);
    vi.mocked(endpoints.getAgentPosts).mockResolvedValue({
      items: [makePost("01P1", "スレッドを開く投稿")],
      nextCursor: null,
    });

    const { router } = renderProfilePage();

    const postText = await screen.findByText("スレッドを開く投稿");
    fireEvent.click(postText);

    await waitFor(() => expect(router.state.location.pathname).toBe("/posts/01P1"));
  });

  it("TC-NOUS68_DEV-08 さらに読み込むで過去投稿の続きを追加し、失敗時は様式②「続きを読み込めませんでした」を出す", async () => {
    const page1: AgentPostsResponse = {
      items: [makePost("01P1", "最初の投稿")],
      nextCursor: "CUR_NEXT",
    };
    vi.mocked(endpoints.getAgentProfile).mockResolvedValue(baseAgent);
    vi.mocked(endpoints.getAgentPosts)
      .mockResolvedValueOnce(page1)
      .mockRejectedValueOnce(new ApiError(500, "INTERNAL_ERROR", "err"))
      .mockResolvedValueOnce({ items: [makePost("01P2", "続きの投稿")], nextCursor: null });

    renderProfilePage();

    expect(await screen.findByText("最初の投稿")).toBeInTheDocument();
    const loadMoreBtn = screen.getByRole("button", { name: "さらに読み込む" });
    fireEvent.click(loadMoreBtn);

    expect(await screen.findByRole("alert")).toHaveTextContent("続きを読み込めませんでした");
    expect(screen.getByRole("button", { name: "さらに読み込む" })).not.toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "さらに読み込む" }));
    expect(await screen.findByText("続きの投稿")).toBeInTheDocument();
  });

  it("TC-NOUS68_DEV-09 404 AGENT_NOT_FOUND のとき様式③「この住人は見つかりません」とタイムラインへのリンクを出す", async () => {
    vi.mocked(endpoints.getAgentProfile).mockRejectedValue(new ApiError(404, "AGENT_NOT_FOUND", "not found"));
    vi.mocked(endpoints.getAgentPosts).mockResolvedValue({ items: [], nextCursor: null });

    renderProfilePage();

    expect(await screen.findByRole("heading", { name: "この住人は見つかりません" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "タイムラインへ" })).toHaveAttribute("href", "/");
  });

  it("TC-NOUS68_DEV-10 500 エラーのとき様式②「プロフィールを読み込めませんでした。時間をおいて再読み込みしてください」を出す", async () => {
    vi.mocked(endpoints.getAgentProfile).mockRejectedValue(new ApiError(500, "INTERNAL_ERROR", "server error"));
    vi.mocked(endpoints.getAgentPosts).mockResolvedValue({ items: [], nextCursor: null });

    renderProfilePage();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "プロフィールを読み込めませんでした。時間をおいて再読み込みしてください",
    );
  });
});
