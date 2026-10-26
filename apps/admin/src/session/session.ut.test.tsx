// 単体テスト（NOUS-99）。観点表は docs/test/unit/NOUS-99/観点表_AWEB_api.json
import { QueryClientProvider } from "@tanstack/react-query";
import { render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockFetch, sessionOk, unauthorized } from "../test/fetchMock";
import { createTestQueryClient } from "../test/renderApp";
import { getCsrfToken, setCsrfToken } from "./csrfToken";
import { loginPathFor, RequireSession } from "./RequireSession";
import { SessionProvider, useSession } from "./SessionProvider";

afterEach(() => {
  vi.unstubAllGlobals();
  setCsrfToken(null);
});

function Probe() {
  const { status, bootstrapFailed, session, signIn, signOut } = useSession();
  return (
    <div>
      <p data-testid="status">{status}</p>
      <p data-testid="failed">{String(bootstrapFailed)}</p>
      <p data-testid="name">{session?.displayName ?? ""}</p>
      <button type="button" onClick={() => void signIn("correct-horse-battery")}>
        signIn
      </button>
      <button type="button" onClick={() => void signOut()}>
        signOut
      </button>
    </div>
  );
}

function renderSession(initialPath = "/") {
  const queryClient = createTestQueryClient();
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <SessionProvider>
          <Routes>
            <Route path="/" element={<Probe />} />
            <Route path="/login" element={<p>LOGIN</p>} />
          </Routes>
        </SessionProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...utils, queryClient };
}

describe("SessionProvider（単体テスト）", () => {
  it.each([
    ["401", { status: 401, body: unauthorized.body }, "false"],
    ["通信の失敗", "network", "true"],
  ] as const)(
    "TC-UT_AWEB-014 起動時のセッションの取得が 401 なら未ログインだけ、通信の失敗なら bootstrapFailed も立てる（%s）",
    async (_label, response, failed) => {
      if (response === "network") {
        vi.stubGlobal(
          "fetch",
          vi.fn(async () => {
            throw new TypeError("Failed to fetch");
          }),
        );
      } else {
        mockFetch({ "GET /admin/api/session": response });
      }

      renderSession();

      await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("unauthenticated"));
      expect(screen.getByTestId("failed")).toHaveTextContent(failed);
      expect(getCsrfToken()).toBeNull();
    },
  );

  it("TC-UT_AWEB-015 起動時のセッションの取得が 200 なら ready にし、表示名と CSRF トークンを置く", async () => {
    mockFetch({ "GET /admin/api/session": sessionOk });

    renderSession();

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("ready"));
    expect(screen.getByTestId("name")).toHaveTextContent("Kaine Yamashiro");
    expect(getCsrfToken()).toBe("csrf-token-1");
  });

  it("TC-UT_AWEB-016 signIn はログインの応答の CSRF トークンを置いて ready にし、signOut はトークンとクエリのキャッシュを捨てて /login へ移る", async () => {
    mockFetch({
      "GET /admin/api/session": unauthorized,
      "POST /admin/api/login": { status: 200, body: { displayName: "Kaine Yamashiro", csrfToken: "csrf-after-login" } },
      "POST /admin/api/logout": { status: 204 },
    });
    const { queryClient } = renderSession();
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("unauthenticated"));
    queryClient.setQueryData(["admin", "world"], { state: "running" });

    await userEvent.click(screen.getByRole("button", { name: "signIn" }));
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("ready"));
    const tokenAfterLogin = getCsrfToken();
    await userEvent.click(screen.getByRole("button", { name: "signOut" }));

    expect(tokenAfterLogin).toBe("csrf-after-login");
    expect(await screen.findByText("LOGIN")).toBeInTheDocument();
    expect(getCsrfToken()).toBeNull();
    expect(queryClient.getQueryData(["admin", "world"])).toBeUndefined();
  });

  it("TC-UT_AWEB-017 useSession を SessionProvider の外で使うと例外にする", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const act = () => renderHook(() => useSession());

    expect(act).toThrow("useSession は SessionProvider の中で使ってください");
  });
});

describe("RequireSession（単体テスト）", () => {
  it("TC-UT_AWEB-018 セッションの確認中は「読み込み中…」を出し、子の画面を出さない", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => undefined)),
    );

    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <MemoryRouter>
          <SessionProvider>
            <RequireSession>
              <p>PROTECTED</p>
            </RequireSession>
          </SessionProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(screen.getByText("読み込み中…")).toBeInTheDocument();
    expect(screen.queryByText("PROTECTED")).toBeNull();
  });

  it.each([
    ["/", "", "/login"],
    ["/settings", "?tab=1", "/login?next=%2Fsettings%3Ftab%3D1"],
  ])(
    "TC-UT_AWEB-019 loginPathFor は / なら next を付けず、それ以外はパスと検索文字列を next に入れる（%j）",
    (pathname, search, expected) => {
      const path = loginPathFor(pathname, search);

      expect(path).toBe(expected);
    },
  );
});
