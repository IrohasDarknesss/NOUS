import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ThreadNode, ThreadView } from "../api/types";
import { ObserverLayout } from "../layout/ObserverLayout";
import { ThreadPage } from "./ThreadPage";

const agentMika = {
  agentId: "01A",
  handle: "mika",
  displayName: "ミカ",
  isAi: true as const,
  state: "active" as const,
};

const agentRen = {
  agentId: "01B",
  handle: "ren",
  displayName: "レン",
  isAi: true as const,
  state: "active" as const,
};

function makeNode(overrides: Partial<ThreadNode> & { postId: string }): ThreadNode {
  return {
    body: "本文",
    hidden: false,
    worldTimeSec: 3600,
    agent: agentMika,
    likeCount: 1,
    children: [],
    moreCount: 0,
    ...overrides,
  };
}

function renderThreadAt(postId: string, threadResponse: (url: string) => Response) {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url.startsWith("/api/world")) {
        return Promise.resolve(
          new Response(JSON.stringify({ state: "running", worldTimeSec: 3600, isRunning: true, updatedAt: "" }), {
            status: 200,
          }),
        );
      }
      return Promise.resolve(threadResponse(url));
    }),
  );

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(
    [
      {
        element: (
          <ObserverLayout>
            <ThreadPage />
          </ObserverLayout>
        ),
        path: "/posts/:postId",
      },
    ],
    { initialEntries: [`/posts/${postId}`] },
  );

  return render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ThreadPage / ThreadNodeView", () => {
  it("TC-NOUS67_DEV-09 hidden の投稿が「管理者が非表示にした投稿」になり本文・表示名が出ず、子の返信は描く", async () => {
    const view: ThreadView = {
      focusPostId: "01ROOT",
      root: makeNode({
        postId: "01ROOT",
        body: null,
        hidden: true,
        agent: null,
        children: [
          makeNode({
            postId: "01CHILD",
            body: "子の返信本文",
            hidden: false,
            agent: agentRen,
          }),
        ],
      }),
    };

    renderThreadAt("01ROOT", () => new Response(JSON.stringify(view), { status: 200 }));

    expect(await screen.findByText("管理者が非表示にした投稿")).toBeInTheDocument();
    expect(screen.queryByText("ミカ")).not.toBeInTheDocument();
    expect(screen.getByText("子の返信本文")).toBeInTheDocument();
    expect(screen.getByText("レン")).toBeInTheDocument();
  });

  it("TC-NOUS67_DEV-10 focus の投稿に強調の印がある", async () => {
    const view: ThreadView = {
      focusPostId: "01FOCUS",
      root: makeNode({
        postId: "01ROOT",
        body: "起点の投稿",
        children: [
          makeNode({
            postId: "01FOCUS",
            body: "開いた返信",
            agent: agentRen,
          }),
        ],
      }),
    };

    const { container } = renderThreadAt("01FOCUS", () => new Response(JSON.stringify(view), { status: 200 }));

    expect(await screen.findByText("開いた返信")).toBeInTheDocument();
    const focusedEl = container.querySelector<HTMLElement>('[data-post-id="01FOCUS"]');
    const rootEl = container.querySelector<HTMLElement>('[data-post-id="01ROOT"]');
    expect(focusedEl).not.toBeNull();
    expect(focusedEl).toHaveAttribute("data-focused", "true");
    expect(focusedEl?.style.background).toBe("rgb(239, 246, 255)");
    expect(focusedEl?.style.borderLeft).toContain("3px solid");
    expect(rootEl).not.toHaveAttribute("data-focused");
  });

  it("TC-NOUS67_DEV-11 moreCount があると「続きを表示（N 件）」が出て、押すと続きを差し込む", async () => {
    const initialView: ThreadView = {
      focusPostId: "01ROOT",
      root: makeNode({
        postId: "01ROOT",
        body: "起点の投稿",
        moreCount: 2,
      }),
    };
    const moreView: ThreadView = {
      focusPostId: "01ROOT",
      root: makeNode({
        postId: "01ROOT",
        body: "起点の投稿",
        children: [
          makeNode({
            postId: "01MORE",
            body: "読み込まれた返信",
            agent: agentRen,
          }),
        ],
      }),
    };

    renderThreadAt("01ROOT", (url) => {
      if (url.includes("from=01ROOT")) {
        return new Response(JSON.stringify(moreView), { status: 200 });
      }
      return new Response(JSON.stringify(initialView), { status: 200 });
    });

    const moreButton = await screen.findByRole("button", { name: "続きを表示（2 件）" });
    fireEvent.click(moreButton);
    expect(await screen.findByText("読み込まれた返信")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "続きを表示（2 件）" })).not.toBeInTheDocument();
  });

  it("TC-NOUS67_DEV-12 404 で「この投稿は見つかりません」を出す", async () => {
    renderThreadAt(
      "01NONE",
      () =>
        new Response(JSON.stringify({ error: { code: "POST_NOT_FOUND", message: "not found" } }), {
          status: 404,
        }),
    );

    expect(await screen.findByText("この投稿は見つかりません")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "タイムラインへ" })).toHaveAttribute("href", "/");
  });
});
