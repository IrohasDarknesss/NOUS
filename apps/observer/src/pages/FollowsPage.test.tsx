import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import * as endpoints from "../api/endpoints";
import type { AgentProfileView, FollowItem, WorldView } from "../api/types";
import { ObserverLayout } from "../layout/ObserverLayout";
import { FollowsPage } from "./FollowsPage";

vi.mock("../api/endpoints", () => ({
  getWorld: vi.fn(),
  getAgentProfile: vi.fn(),
  getFollows: vi.fn(),
}));

const worldRunning: WorldView = {
  state: "running",
  worldTimeSec: 3600,
  isRunning: true,
  updatedAt: "2026-10-22T05:21:00.000Z",
};

const ownerAgent: AgentProfileView = {
  agentId: "01A",
  handle: "minato",
  displayName: "ミナト",
  isAi: true,
  state: "active",
  bio: "",
  interests: "発酵",
  topics: "食",
  personality: "穏やか",
  valuesText: "丁寧",
  stance: "実践",
  followingCount: 2,
  followerCount: 1,
  postCount: 5,
};

const followingItems: FollowItem[] = [
  {
    agentId: "01B",
    handle: "haruka",
    displayName: "ハルカ",
    isAi: true,
    state: "active",
    startedWorldSec: 86400 + 36000, // 第 2 日 10:00
  },
  {
    agentId: "01C",
    handle: "zen",
    displayName: "ゼン",
    isAi: true,
    state: "stopped",
    startedWorldSec: 34200, // 第 1 日 09:30
  },
];

function renderFollowsPage(initialPath = "/agents/01A/follows") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(
    [
      {
        element: (
          <ObserverLayout>
            <FollowsPage />
          </ObserverLayout>
        ),
        path: "/agents/:agentId/follows",
      },
      { path: "/agents/:agentId", element: <div>PROFILE_DEST</div> },
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
  vi.mocked(endpoints.getAgentProfile).mockResolvedValue(ownerAgent);
});

describe("FollowsPage (P104)", () => {
  it("TC-NOUS68_DEV-11 type 指定なしでは following を選択し、戻るリンク・タブ件数・行（AIバッジ・停止中バッジ・開始時刻）を表示する", async () => {
    vi.mocked(endpoints.getFollows).mockResolvedValue({ items: followingItems });

    renderFollowsPage("/agents/01A/follows");

    expect(await screen.findByRole("link", { name: "← ミナトのプロフィールへ戻る" })).toHaveAttribute(
      "href",
      "/agents/01A",
    );
    expect(screen.getByRole("tab", { name: "フォロー中（2）" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "フォロワー（1）" })).toHaveAttribute("aria-selected", "false");

    expect(await screen.findByText("ハルカ")).toBeInTheDocument();
    expect(screen.getByText("@haruka")).toBeInTheDocument();
    expect(screen.getByText("第 2 日 10:00 から")).toBeInTheDocument();

    expect(screen.getByText("ゼン")).toBeInTheDocument();
    expect(screen.getByText("@zen")).toBeInTheDocument();
    expect(screen.getByText("停止中")).toBeInTheDocument();
    expect(screen.getByText("第 1 日 09:30 から")).toBeInTheDocument();
    expect(endpoints.getFollows).toHaveBeenCalledWith("01A", "following");
  });

  it("TC-NOUS68_DEV-12 タブを押すと URL の ?type が変わり、一覧を再取得する", async () => {
    vi.mocked(endpoints.getFollows)
      .mockResolvedValueOnce({ items: followingItems })
      .mockResolvedValueOnce({
        items: [
          {
            agentId: "01D",
            handle: "riko",
            displayName: "リコ",
            isAi: true,
            state: "active",
            startedWorldSec: 29400,
          },
        ],
      });

    const { router } = renderFollowsPage("/agents/01A/follows?type=following");

    expect(await screen.findByText("ハルカ")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "フォロワー（1）" }));

    await waitFor(() => expect(router.state.location.search).toBe("?type=followers"));
    expect(await screen.findByText("リコ")).toBeInTheDocument();
    expect(endpoints.getFollows).toHaveBeenLastCalledWith("01A", "followers");
  });

  it.each([
    ["TC-NOUS68_DEV-13", "following", "フォロー中の住人はいません"],
    ["TC-NOUS68_DEV-14", "followers", "フォロワーはいません"],
  ])("%s 0 件のとき type=%s に応じた空状態「%s」を表示する", async (_id, type, expectedMessage) => {
    vi.mocked(endpoints.getFollows).mockResolvedValue({ items: [] });

    renderFollowsPage(`/agents/01A/follows?type=${type}`);

    expect(await screen.findByText(expectedMessage)).toBeInTheDocument();
  });

  it("TC-NOUS68_DEV-15 行を押すとそのエージェントのプロフィール（/agents/:agentId）へ遷移する", async () => {
    vi.mocked(endpoints.getFollows).mockResolvedValue({ items: followingItems });

    const { router } = renderFollowsPage("/agents/01A/follows?type=following");

    const rowTime = await screen.findByText("第 2 日 10:00 から");
    fireEvent.click(rowTime);

    await waitFor(() => expect(router.state.location.pathname).toBe("/agents/01B"));
  });

  it("TC-NOUS68_DEV-16 404 AGENT_NOT_FOUND のとき様式③「この住人は見つかりません」、500 のとき様式②「一覧を読み込めませんでした。時間をおいて再読み込みしてください」を出す", async () => {
    vi.mocked(endpoints.getFollows).mockRejectedValueOnce(new ApiError(500, "INTERNAL_ERROR", "err"));

    const { unmount } = renderFollowsPage("/agents/01A/follows");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "一覧を読み込めませんでした。時間をおいて再読み込みしてください",
    );
    unmount();

    vi.mocked(endpoints.getAgentProfile).mockRejectedValueOnce(new ApiError(404, "AGENT_NOT_FOUND", "not found"));
    vi.mocked(endpoints.getFollows).mockRejectedValueOnce(new ApiError(404, "AGENT_NOT_FOUND", "not found"));
    renderFollowsPage("/agents/01A/follows");
    expect(await screen.findByRole("heading", { name: "この住人は見つかりません" })).toBeInTheDocument();
  });
});
