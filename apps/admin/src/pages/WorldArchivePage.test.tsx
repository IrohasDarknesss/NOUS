import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockFetch, sessionOk, worldOk } from "../test/fetchMock";
import { renderApp } from "../test/renderApp";

afterEach(() => {
  vi.unstubAllGlobals();
});

const worldsBody = {
  items: [
    {
      worldId: "01JWORLD000000000000000002",
      name: "世界 2026-10-22",
      state: "running" as const,
      createdAt: "2026-10-22T00:00:00.000Z",
      startedAt: "2026-10-22T01:00:00.000Z",
      archivedAt: null,
      worldTimeSec: 7260,
      agentCount: 10,
      postCount: 120,
    },
    {
      worldId: "01JWORLD000000000000000001",
      name: "世界 2026-10-20",
      state: "archived" as const,
      createdAt: "2026-10-20T00:00:00.000Z",
      startedAt: "2026-10-20T01:00:00.000Z",
      archivedAt: "2026-10-21T12:00:00.000Z",
      worldTimeSec: 86_400,
      agentCount: 8,
      postCount: 95,
    },
  ],
};

const archivePostsBody = {
  items: [
    {
      postId: "01JARCHPOST000000000000001",
      body: "アーカイブの公開投稿",
      visibility: "public" as const,
      worldTimeSec: 3600,
      createdAt: "2026-10-20T02:00:00.000Z",
      agent: { agentId: "01JAGENT000000000000000001", displayName: "ミナト" },
      replyToPostId: null,
      generationEventId: "01JARCHEVENT00000000000001",
    },
    {
      postId: "01JARCHPOST000000000000002",
      body: "アーカイブの非表示投稿",
      visibility: "hidden" as const,
      worldTimeSec: 7200,
      createdAt: "2026-10-20T03:00:00.000Z",
      agent: { agentId: "01JAGENT000000000000000001", displayName: "ミナト" },
      replyToPostId: null,
      generationEventId: null,
    },
  ],
  nextCursor: null,
};

const archiveGenerationsBody = {
  items: [
    {
      eventId: "01JARCHEVENT00000000000001",
      startedAt: "2026-10-20T02:00:00.000Z",
      worldTimeSec: 3600,
      agent: { agentId: "01JAGENT000000000000000001", displayName: "ミナト" },
      action: "post" as const,
      decidedBy: "llm" as const,
      status: "succeeded" as const,
      failureKind: null,
      neurons: 14.8,
      attemptCount: 1,
      hasConsistencyFlags: false,
    },
  ],
  nextCursor: null,
};

describe("WorldArchivePage (P211)", () => {
  it("TC-NOUS72_DEV-17 P211 世界の一覧で archived の行だけ「開く」を表示し、稼働中の行には「開く」を出さない", async () => {
    mockFetch({
      "GET /admin/api/session": sessionOk,
      "GET /admin/api/world": worldOk,
      "GET /admin/api/worlds": { status: 200, body: worldsBody },
    });

    renderApp("/worlds");
    expect(await screen.findByText("世界 2026-10-22")).toBeInTheDocument();
    expect(screen.getByText("世界 2026-10-20")).toBeInTheDocument();

    const openButtons = screen.getAllByRole("button", { name: "開く" });
    expect(openButtons).toHaveLength(1);
    expect(screen.getByText("現在")).toBeInTheDocument();
  });

  it("TC-NOUS72_DEV-18 P211 アーカイブの世界を開くと読み取り専用の帯と投稿・生成ログを表示し、編集・削除・非表示の操作ボタンを一切置かない", async () => {
    mockFetch({
      "GET /admin/api/session": sessionOk,
      "GET /admin/api/world": worldOk,
      "GET /admin/api/worlds": { status: 200, body: worldsBody },
      "GET /admin/api/worlds/01JWORLD000000000000000001/posts": {
        status: 200,
        body: archivePostsBody,
      },
      "GET /admin/api/worlds/01JWORLD000000000000000001/generations": {
        status: 200,
        body: archiveGenerationsBody,
      },
    });

    const { router } = renderApp("/worlds");
    await screen.findByText("世界 2026-10-20");
    await userEvent.click(screen.getByRole("button", { name: "開く" }));

    expect(await screen.findByText("この世界はアーカイブです。内容は変更できません")).toBeInTheDocument();
    expect(await screen.findByText("アーカイブの公開投稿")).toBeInTheDocument();
    expect(screen.getByText("アーカイブの非表示投稿")).toBeInTheDocument();
    expect(router.state.location.search).toContain("worldId=01JWORLD000000000000000001");

    expect(screen.queryByRole("button", { name: "非表示にする" })).toBeNull();
    expect(screen.queryByRole("button", { name: "取り消す" })).toBeNull();
    expect(screen.queryByRole("button", { name: "編集" })).toBeNull();
    expect(screen.queryByRole("button", { name: "削除" })).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("TC-NOUS72_DEV-19 P211 生成ログの行を押すと /generations/{eventId} へ移動し、404 WORLD_NOT_FOUND では様式③「この世界は見つかりません」と一覧へのリンクを表示する", async () => {
    mockFetch({
      "GET /admin/api/session": sessionOk,
      "GET /admin/api/world": worldOk,
      "GET /admin/api/worlds": { status: 200, body: worldsBody },
      "GET /admin/api/worlds/01JWORLD000000000000000001/posts": {
        status: 200,
        body: archivePostsBody,
      },
      "GET /admin/api/worlds/01JWORLD000000000000000001/generations": {
        status: 200,
        body: archiveGenerationsBody,
      },
      "GET /admin/api/worlds/01JWORLD999999999999999999/posts": {
        status: 404,
        body: { error: { code: "WORLD_NOT_FOUND", message: "世界が見つかりません" } },
      },
    });

    const { router, unmount } = renderApp("/worlds?worldId=01JWORLD000000000000000001&tab=generations");
    expect(await screen.findByText("14.8")).toBeInTheDocument();
    await userEvent.click(screen.getByText("14.8"));
    await waitFor(() => expect(router.state.location.pathname).toBe("/generations/01JARCHEVENT00000000000001"));

    unmount();

    renderApp("/worlds?worldId=01JWORLD999999999999999999");
    expect(await screen.findByText("この世界は見つかりません")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /一覧/ })).toHaveAttribute("href", "/worlds");
  });
});
