import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { protectedRoutes } from "./router";
import { mockFetch, sessionOk, unauthorized, worldOk } from "./test/fetchMock";
import { renderApp } from "./test/renderApp";

afterEach(() => vi.unstubAllGlobals());

const screens: [string, string][] = [
  ["/", "P202"],
  ["/agents", "P203"],
  ["/agents/new", "P204"],
  ["/agents/01JABCDEFGHJKMNPQRSTVWXYZ0/edit", "P204"],
  ["/settings", "P205"],
  ["/metrics", "P206"],
  ["/generations", "P207"],
  ["/generations/01JABCDEFGHJKMNPQRSTVWXYZ0", "P208"],
  ["/moderation", "P209"],
  ["/invitations", "P210"],
  ["/worlds", "P211"],
];

describe("router", () => {
  it("TC-NOUS50_DEV-09 認証が要る画面は 10 画面・11 ルート（P204 は新規と編集）が登録されている", () => {
    expect(protectedRoutes).toHaveLength(11);
  });

  it.each(screens)("TC-NOUS50_DEV-10 ログイン済みなら %s で %s を表示する", async (path, screenId) => {
    mockFetch({ "GET /admin/api/session": sessionOk, "GET /admin/api/world": worldOk });
    renderApp(path);
    expect(await screen.findByText(new RegExp(screenId))).toBeInTheDocument();
  });

  it("TC-NOUS50_DEV-11 /login は認証なしで P201 を表示する", async () => {
    mockFetch({ "GET /admin/api/session": unauthorized });
    renderApp("/login");
    expect(await screen.findByText(/P201/)).toBeInTheDocument();
  });

  it("TC-NOUS50_DEV-12 未ログインで認証が要る画面を開くと /login?next=… へ移る", async () => {
    mockFetch({ "GET /admin/api/session": unauthorized });
    const { router } = renderApp("/generations?status=failed");
    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    expect(router.state.location.search).toBe(`?next=${encodeURIComponent("/generations?status=failed")}`);
  });

  it("TC-NOUS50_DEV-13 パスワード未設定（409 ADMIN_NOT_SET）でも /login へ移る", async () => {
    mockFetch({
      "GET /admin/api/session": { status: 409, body: { error: { code: "ADMIN_NOT_SET", message: "未設定" } } },
    });
    const { router } = renderApp("/");
    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
  });

  it("TC-NOUS50_DEV-14 未知のパスは / へ戻す", async () => {
    mockFetch({ "GET /admin/api/session": sessionOk, "GET /admin/api/world": worldOk });
    const { router } = renderApp("/unknown/path");
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
  });

  it("TC-NOUS50_DEV-15 ヘッダーに世界の状態と世界内時間、ログアウトで /login へ移る", async () => {
    const fetchMock = mockFetch({
      "GET /admin/api/session": sessionOk,
      "GET /admin/api/world": worldOk,
      "POST /admin/api/logout": { status: 204 },
    });
    const { router } = renderApp("/");
    expect(await screen.findByText("稼働")).toBeInTheDocument();
    expect(screen.getByText("第 1 日 02:01")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "ログアウト" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    const logoutCall = fetchMock.mock.calls.find(([url]) => String(url) === "/admin/api/logout");
    expect((logoutCall?.[1]?.headers as Record<string, string>)["X-CSRF-Token"]).toBe("csrf-token-1");
  });

  it("TC-NOUS50_DEV-16 ログアウトの API が失敗しても /login へ移る", async () => {
    mockFetch({
      "GET /admin/api/session": sessionOk,
      "GET /admin/api/world": worldOk,
      "POST /admin/api/logout": { status: 500, body: { error: { code: "INTERNAL_ERROR", message: "x" } } },
    });
    const { router } = renderApp("/");
    await userEvent.click(await screen.findByRole("button", { name: "ログアウト" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
  });

  it("TC-NOUS50_DEV-17 サイドメニューに 8 項目があり、現在のパスを強調する", async () => {
    mockFetch({ "GET /admin/api/session": sessionOk, "GET /admin/api/world": worldOk });
    renderApp("/metrics");
    const nav = await screen.findByRole("navigation", { name: "管理メニュー" });
    const links = nav.querySelectorAll("a");
    expect(links).toHaveLength(8);
    expect(screen.getByRole("link", { name: "利用量と運用指標" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "実行制御" })).not.toHaveAttribute("aria-current");
  });
});
