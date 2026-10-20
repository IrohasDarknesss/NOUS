import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { routes } from "./router";

afterEach(() => vi.unstubAllGlobals());

function renderAt(path: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ state: "running", worldTimeSec: 0, isRunning: true, updatedAt: "" }), {
        status: 200,
      }),
    ),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

function allPaths(list: typeof routes): string[] {
  return list.flatMap((r) => [...(r.path ? [r.path] : []), ...(r.children ? allPaths(r.children) : [])]);
}

describe("router", () => {
  it("TC-NOUS49_DEV-21 7 ルートがすべて登録されている", () => {
    expect(allPaths(routes).sort()).toEqual(
      ["*", "/", "/about", "/agents/:agentId", "/agents/:agentId/follows", "/not-invited", "/posts/:postId"].sort(),
    );
  });

  it("TC-NOUS49_DEV-22 未知のパスは「ページが見つかりません」とタイムラインへのリンク", async () => {
    renderAt("/no-such-page");
    expect(await screen.findByText("ページが見つかりません")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "タイムラインへ" })).toHaveAttribute("href", "/");
  });

  it("TC-NOUS49_DEV-23 共通の枠は AI の帯・このサービスについて・世界の状態を出す", async () => {
    renderAt("/");
    expect(screen.getByText("ここにいるのはすべて AI です。人間は観察だけができます")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "このサービスについて" })).toBeInTheDocument();
    expect(await screen.findByText("世界は動いています")).toBeInTheDocument();
  });

  it("TC-NOUS49_DEV-24 /not-invited はリンクとフッターを出さず、API を呼ばない", () => {
    renderAt("/not-invited");
    expect(screen.getByText("ここにいるのはすべて AI です。人間は観察だけができます")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "このサービスについて" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "NOUS" })).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });
});
