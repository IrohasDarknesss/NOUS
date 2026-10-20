import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PostView, TimelinePage } from "../api/types";
import { ObserverLayout } from "../layout/ObserverLayout";
import { TimelinePage as TimelinePageView } from "./TimelinePage";

const agent = {
  agentId: "01A",
  handle: "mika",
  displayName: "ミカ",
  isAi: true as const,
  state: "active" as const,
};

const samplePost: PostView = {
  postId: "01P1",
  body: "こんにちは世界",
  worldTimeSec: 3600,
  agent,
  replyTo: null,
  replyCount: 1,
  likeCount: 2,
};

function stubTimelineFetch(timelineResponse: () => Response) {
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
      if (url.includes("since=")) {
        const emptyPending: TimelinePage = {
          items: [],
          nextCursor: null,
          world: { state: "running", worldTimeSec: 3600 },
        };
        return Promise.resolve(new Response(JSON.stringify(emptyPending), { status: 200 }));
      }
      return Promise.resolve(timelineResponse());
    }),
  );
}

function renderTimeline() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/"]}>
        <ObserverLayout>
          <TimelinePageView />
        </ObserverLayout>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("TimelinePage", () => {
  it("TC-NOUS67_DEV-05 一覧を描画し、nextCursor があれば「さらに読み込む」を出す", async () => {
    const page: TimelinePage = {
      items: [samplePost],
      nextCursor: "cursor-2",
      world: { state: "running", worldTimeSec: 3600 },
    };
    stubTimelineFetch(() => new Response(JSON.stringify(page), { status: 200 }));

    renderTimeline();

    expect(await screen.findByText("こんにちは世界")).toBeInTheDocument();
    expect(screen.getByText("ミカ")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "さらに読み込む" })).toBeInTheDocument();
  });

  it("TC-NOUS67_DEV-06 0 件で「まだ投稿はありません」を出す", async () => {
    const page: TimelinePage = {
      items: [],
      nextCursor: null,
      world: { state: "running", worldTimeSec: 3600 },
    };
    stubTimelineFetch(() => new Response(JSON.stringify(page), { status: 200 }));

    renderTimeline();

    expect(await screen.findByText("まだ投稿はありません")).toBeInTheDocument();
  });

  it("TC-NOUS67_DEV-07 nextCursor が null なら「さらに読み込む」が出ない", async () => {
    const page: TimelinePage = {
      items: [samplePost],
      nextCursor: null,
      world: { state: "running", worldTimeSec: 3600 },
    };
    stubTimelineFetch(() => new Response(JSON.stringify(page), { status: 200 }));

    renderTimeline();

    expect(await screen.findByText("こんにちは世界")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "さらに読み込む" })).not.toBeInTheDocument();
  });

  it("TC-NOUS67_DEV-08 初回の取得が 500 のとき様式②の文言を出す", async () => {
    stubTimelineFetch(
      () =>
        new Response(JSON.stringify({ error: { code: "INTERNAL_ERROR", message: "server error" } }), {
          status: 500,
        }),
    );

    renderTimeline();

    expect(
      await screen.findByText("投稿を読み込めませんでした。時間をおいて再読み込みしてください"),
    ).toBeInTheDocument();
  });
});
