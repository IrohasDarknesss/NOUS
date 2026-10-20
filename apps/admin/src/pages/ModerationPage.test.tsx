import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockFetch, sessionOk, worldOk } from "../test/fetchMock";
import { renderApp } from "../test/renderApp";

afterEach(() => {
  vi.unstubAllGlobals();
});

const agentsBody = {
  items: [
    {
      agentId: "01JAGENT000000000000000001",
      handle: "minato",
      displayName: "ミナト",
      state: "active" as const,
      activityLevel: 3,
      postCount: 10,
      lastActionAt: "2026-10-22T05:00:00.000Z",
      lastAction: "post" as const,
    },
  ],
  worldState: "running" as const,
};

const samplePosts = [
  {
    postId: "01JPOST0000000000000000001",
    body: "<script>alert(1)</script>朝の投稿",
    visibility: "public" as const,
    worldTimeSec: 3600,
    createdAt: "2026-10-22T05:00:00.000Z",
    agent: { agentId: "01JAGENT000000000000000001", displayName: "ミナト" },
    replyToPostId: null,
    generationEventId: "01JEVENT000000000000000001",
  },
  {
    postId: "01JPOST0000000000000000002",
    body: "非表示済みの投稿",
    visibility: "hidden" as const,
    worldTimeSec: 1800,
    createdAt: "2026-10-22T04:30:00.000Z",
    agent: { agentId: "01JAGENT000000000000000001", displayName: "ミナト" },
    replyToPostId: null,
    generationEventId: null,
  },
];

describe("ModerationPage (P209)", () => {
  it("TC-NOUS72_DEV-08 P209 検索語が 51 字以上なら「50 字以内で入力してください」を表示し、50 字以内なら URL を更新して検索する", async () => {
    const fetchMock = mockFetch({
      "GET /admin/api/session": sessionOk,
      "GET /admin/api/world": worldOk,
      "GET /admin/api/agents": { status: 200, body: agentsBody },
      "GET /admin/api/posts": { status: 200, body: { items: samplePosts, nextCursor: null } },
    });

    const { router } = renderApp("/moderation?postId=01JPOST0000000000000000001");
    expect(await screen.findByText("<script>alert(1)</script>朝の投稿")).toBeInTheDocument();

    const input = screen.getByLabelText("本文の検索");
    await userEvent.clear(input);
    await userEvent.type(input, "あ".repeat(51));
    await userEvent.click(screen.getByRole("button", { name: "検索" }));

    expect(screen.getByRole("alert")).toHaveTextContent("50 字以内で入力してください");
    expect(router.state.location.search).toContain("postId=01JPOST0000000000000000001");

    await userEvent.clear(input);
    await userEvent.type(input, "朝の投稿");
    await userEvent.click(screen.getByRole("button", { name: "検索" }));

    await waitFor(() => {
      expect(router.state.location.search).toContain(`q=${encodeURIComponent("朝の投稿")}`);
      expect(router.state.location.search).not.toContain("postId=");
    });

    const postCalls = fetchMock.mock.calls.filter(([url]) => String(url).startsWith("/admin/api/posts"));
    expect(postCalls.some(([url]) => String(url).includes(`q=${encodeURIComponent("朝の投稿")}`))).toBe(true);
  });

  it("TC-NOUS72_DEV-09 P209 本文をテキストとして表示し、非表示の理由が 201 字以上なら検証エラー、200 字以内なら非表示にして一覧と履歴を更新しトーストを出す", async () => {
    const fetchMock = mockFetch({
      "GET /admin/api/session": sessionOk,
      "GET /admin/api/world": worldOk,
      "GET /admin/api/agents": { status: 200, body: agentsBody },
      "GET /admin/api/posts": { status: 200, body: { items: samplePosts, nextCursor: null } },
      "POST /admin/api/posts/01JPOST0000000000000000001/hide": {
        status: 200,
        body: { postId: "01JPOST0000000000000000001", visibility: "hidden" },
      },
    });

    const { queryClient } = renderApp("/moderation");
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    expect(await screen.findByText("<script>alert(1)</script>朝の投稿")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "非表示にする" }));
    const dialog = screen.getByRole("dialog");
    const reasonInput = within(dialog).getByLabelText("理由");

    await userEvent.type(reasonInput, "い".repeat(201));
    await userEvent.click(within(dialog).getByRole("button", { name: "非表示にする" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("200 字以内で入力してください");

    await userEvent.clear(reasonInput);
    await userEvent.type(reasonInput, "スパム投稿のため");
    await userEvent.click(within(dialog).getByRole("button", { name: "非表示にする" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    expect(screen.getByRole("status")).toHaveTextContent("非表示にしました。観察画面から見えなくなります");
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["admin", "posts"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["admin", "hideRecords"] });

    const hideCall = fetchMock.mock.calls.find(
      ([url]) => String(url) === "/admin/api/posts/01JPOST0000000000000000001/hide",
    );
    expect(hideCall?.[1]?.body).toBe(JSON.stringify({ reason: "スパム投稿のため" }));
  });

  it("TC-NOUS72_DEV-10 P209 非表示・取り消しで 409 ALREADY_HIDDEN・NOT_HIDDEN が返ったら様式②を表示して一覧を取り直す", async () => {
    mockFetch({
      "GET /admin/api/session": sessionOk,
      "GET /admin/api/world": worldOk,
      "GET /admin/api/agents": { status: 200, body: agentsBody },
      "GET /admin/api/posts": { status: 200, body: { items: samplePosts, nextCursor: null } },
      "POST /admin/api/posts/01JPOST0000000000000000001/hide": {
        status: 409,
        body: { error: { code: "ALREADY_HIDDEN", message: "すでに非表示です" } },
      },
    });

    const { queryClient } = renderApp("/moderation");
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await screen.findByText("<script>alert(1)</script>朝の投稿");
    await userEvent.click(screen.getByRole("button", { name: "非表示にする" }));
    const dialog = screen.getByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "非表示にする" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "投稿の状態が変わったため、操作できませんでした。一覧を更新します",
    );
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["admin", "posts"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["admin", "hideRecords"] });
  });

  it("TC-NOUS72_DEV-11 P209 generationEventId がある行だけ生成ログへのリンクを出し、履歴タブに切り替えると非表示の履歴を取得する", async () => {
    const fetchMock = mockFetch({
      "GET /admin/api/session": sessionOk,
      "GET /admin/api/world": worldOk,
      "GET /admin/api/agents": { status: 200, body: agentsBody },
      "GET /admin/api/posts": { status: 200, body: { items: samplePosts, nextCursor: null } },
      "GET /admin/api/hide-records": {
        status: 200,
        body: {
          items: [
            {
              hideId: "01JHIDE0000000000000000001",
              postId: "01JPOST0000000000000000002",
              operation: "hide",
              reason: null,
              operatedAt: "2026-10-22T05:00:00.000Z",
              postBodyExcerpt: "非表示済みの投稿",
            },
          ],
          nextCursor: null,
        },
      },
    });

    renderApp("/moderation");
    await screen.findByText("非表示済みの投稿");

    const logLinks = screen.getAllByRole("link", { name: "生成ログ" });
    expect(logLinks).toHaveLength(1);
    expect(logLinks[0]).toHaveAttribute("href", "/generations/01JEVENT000000000000000001");

    expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith("/admin/api/hide-records"))).toBe(false);

    await userEvent.click(screen.getByRole("tab", { name: "非表示の履歴" }));
    expect(await screen.findByText("2026/10/22 14:00")).toBeInTheDocument();
    expect(screen.getByText("―")).toBeInTheDocument();
  });
});
