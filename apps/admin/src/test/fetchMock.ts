// テスト用の fetch の差し替え。パスごとに応答を決める
import { vi } from "vitest";

export interface MockResponse {
  status: number;
  body?: unknown;
}

export type MockRoutes = Record<string, MockResponse | ((init: RequestInit | undefined) => MockResponse)>;

export function jsonResponse({ status, body }: MockResponse): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** "METHOD path" をキーに応答を返す fetch を差し込む。返り値の mock で呼び出しを確かめる */
export function mockFetch(routes: MockRoutes) {
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
    const path = url.replace(/^https?:\/\/[^/]+/, "").split("?")[0];
    const key = `${init?.method ?? "GET"} ${path}`;
    const route = routes[key];
    if (!route) return jsonResponse({ status: 404, body: { error: { code: "INTERNAL_ERROR", message: key } } });
    return jsonResponse(typeof route === "function" ? route(init) : route);
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

export const sessionOk: MockResponse = {
  status: 200,
  body: { displayName: "Kaine Yamashiro", csrfToken: "csrf-token-1", expiresAt: "2026-10-22T08:00:00.000Z" },
};

export const unauthorized: MockResponse = {
  status: 401,
  body: { error: { code: "ADMIN_UNAUTHORIZED", message: "ログインしてください" } },
};

export const worldOk: MockResponse = {
  status: 200,
  body: {
    worldId: "01JABCDEFGHJKMNPQRSTVWXYZ0",
    name: "世界 2026-10-22",
    state: "running",
    stopReason: null,
    worldTimeSec: 7260,
    cycleNo: 22,
    nextCycleAt: "2026-10-22T05:40:00.000Z",
    usage: {
      usageDate: "2026-10-22",
      neurons: 2104.5,
      neuronsLimit: 9500,
      runs: 132,
      runsLimit: 480,
      freeTierNeurons: 10000,
    },
    runningGenerations: 1,
    agentCounts: { active: 9, stopped: 1 },
  },
};
