// 単体テスト（NOUS-106）の描画とデータの補助。*.ut.test.ts(x) だけが使う
import { notifyManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { MemoryRouter, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { vi } from "vitest";
import type {
  AgentProfileView,
  AgentSummary,
  FollowItem,
  PostView,
  ThreadNode,
  TimelinePage,
  WorldView,
} from "../api/types";
import { ObserverLayout } from "../layout/ObserverLayout";

export const agentMika: AgentSummary = {
  agentId: "01A",
  handle: "mika",
  displayName: "ミカ",
  isAi: true,
  state: "active",
};

export const agentRen: AgentSummary = {
  agentId: "01B",
  handle: "ren",
  displayName: "レン",
  isAi: true,
  state: "active",
};

export const WORLD_RUNNING: WorldView = {
  state: "running",
  worldTimeSec: 3600,
  isRunning: true,
  updatedAt: "2026-10-22T05:21:00.000Z",
};

export function makePost(postId: string, overrides: Partial<PostView> = {}): PostView {
  return {
    postId,
    body: `本文 ${postId}`,
    worldTimeSec: 3600,
    agent: agentMika,
    replyTo: null,
    replyCount: 0,
    likeCount: 0,
    ...overrides,
  };
}

export function makeTimelinePage(items: PostView[], nextCursor: string | null = null): TimelinePage {
  return { items, nextCursor, world: { state: "running", worldTimeSec: 3600 } };
}

export function makeNode(postId: string, overrides: Partial<ThreadNode> = {}): ThreadNode {
  return {
    postId,
    body: `本文 ${postId}`,
    hidden: false,
    worldTimeSec: 3600,
    agent: agentMika,
    likeCount: 0,
    children: [],
    moreCount: 0,
    ...overrides,
  };
}

export function makeProfile(overrides: Partial<AgentProfileView> = {}): AgentProfileView {
  return {
    ...agentMika,
    bio: "港町に住んでいます",
    interests: "散歩",
    topics: "街",
    personality: "穏やか",
    valuesText: "誠実",
    stance: "中立",
    followingCount: 2,
    followerCount: 3,
    postCount: 4,
    ...overrides,
  };
}

export function makeFollowItem(agent: AgentSummary, startedWorldSec = 3600): FollowItem {
  return { ...agent, startedWorldSec };
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export function errorResponse(status: number, code: string, message = "error"): Response {
  return jsonResponse({ error: { code, message } }, status);
}

/** URL ごとに応答を返す。handler が undefined を返した /api/world は稼働中の世界を返す */
export type FetchHandler = (url: string) => Response | Promise<Response> | undefined;

export function stubFetch(handler: FetchHandler = () => undefined) {
  const mock = vi.fn((input: string | URL | Request) => {
    const url = String(input);
    const res = handler(url);
    if (res !== undefined) return Promise.resolve(res);
    if (url.startsWith("/api/world")) return Promise.resolve(jsonResponse(WORLD_RUNNING));
    return Promise.resolve(errorResponse(404, "NOT_FOUND"));
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

/** fetch に渡された URL のうち、prefix で始まるもの */
export function calledUrls(mock: ReturnType<typeof stubFetch>, prefix: string): string[] {
  return mock.mock.calls.map(([input]) => String(input)).filter((url) => url.startsWith(prefix));
}

export function makeClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

export function queryWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

/** 今のパスとクエリを data-testid="location" に出す（遷移の確認用） */
export function LocationProbe() {
  const { pathname, search } = useLocation();
  return <div data-testid="location">{`${pathname}${search}`}</div>;
}

interface RenderOptions {
  /** ルートの定義（例 /posts/:postId） */
  route: string;
  /** 開くパス */
  path: string;
  /** path より前の履歴 */
  history?: string[];
  client?: QueryClient;
}

/** ObserverLayout の中に ui を置いて描画する。他のパスへの遷移は「遷移先」と出す */
export function renderInLayout(ui: ReactElement, { route, path, history = [], client = makeClient() }: RenderOptions) {
  const entries = [...history, path];
  const result = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
        <Routes>
          <Route
            element={
              <ObserverLayout>
                <Outlet />
              </ObserverLayout>
            }
          >
            <Route path={route} element={ui} />
            <Route path="*" element={<p>遷移先</p>} />
          </Route>
        </Routes>
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...result, client };
}

/** document.visibilityState を変えて visibilitychange を送る */
export function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
}

/**
 * ポーリングを見るテスト用。setTimeout・setInterval・Date だけを差し替え、画面を前面にする
 * （jsdom の visibilityState は既定で "prerender" のため、前面にしないとポーリングが動かない）
 */
export function useFakePollingTimers(now = "2026-10-22T05:21:00.000Z"): void {
  setVisibility("visible");
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  vi.setSystemTime(new Date(now));
  // TanStack Query の通知は既定で setTimeout(0)。偽の時計は時刻を進める途中に張られた 0 ミリ秒のタイマーを
  // 1 ミリ秒後に回すので、境界値の時刻がずれないよう、通知は microtask で流す
  notifyManager.setScheduler((callback) => {
    queueMicrotask(callback);
  });
}

/** useFakePollingTimers の後片付け。通知の流し方を既定に戻す */
export function restoreRealTimers(): void {
  vi.useRealTimers();
  notifyManager.setScheduler((callback) => {
    setTimeout(callback, 0);
  });
}

/** 偽の時計を ms 進め、その間の Promise の続きと React の更新を流す */
export async function advance(ms = 0): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
    // 応答の本文の読み込みは setImmediate（差し替えていない）で進むので、実際の macrotask も回す
    for (let i = 0; i < 30; i++) {
      await vi.advanceTimersByTimeAsync(0);
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  });
}
