// 単体テスト（NOUS-99）。観点表は docs/test/unit/NOUS-99/観点表_P201.json
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import { jsonResponse, mockFetch, unauthorized, worldOk, type MockRoutes } from "../test/fetchMock";
import { renderApp } from "../test/renderApp";
import {
  ADMIN_NOT_SET_MESSAGE,
  extractLockedUntil,
  LOGIN_FAILED_MESSAGE,
  SERVER_CONNECT_ERROR_MESSAGE,
  validatePassword,
} from "./LoginPage";

afterEach(() => vi.unstubAllGlobals());

const PASSWORD = "valid-password-123";
const loginFailed = { status: 401, body: { error: { code: "LOGIN_FAILED", message: LOGIN_FAILED_MESSAGE } } };

async function openLogin(routes: MockRoutes, path = "/login") {
  const mock = mockFetch({ "GET /admin/api/session": unauthorized, ...routes });
  const utils = renderApp(path);
  const input = await screen.findByLabelText("パスワード");
  return { ...utils, mock, input };
}

function loginCalls(mock: ReturnType<typeof mockFetch>): number {
  return mock.mock.calls.filter(([url]) => String(url) === "/admin/api/login").length;
}

describe("P201 LoginPage（単体テスト）", () => {
  it("TC-UT_P201-001 パスワードの文字数はコードポイントで数え、絵文字 12 字は通り 11 字は 12 字未満にする", () => {
    const twelve = validatePassword("\u{1F600}".repeat(12));
    const eleven = validatePassword("\u{1F600}".repeat(11));

    expect(twelve).toBeNull();
    expect(eleven).toBe("12 字以上で入力してください");
  });

  it("TC-UT_P201-002 入力中に 129 字になったらすぐ「128 字以内で入力してください」を出し、128 字に戻すと消す", async () => {
    const { input } = await openLogin({});

    await userEvent.click(input);
    await userEvent.paste("a".repeat(129));
    const shown = screen.queryByText("128 字以内で入力してください");
    await userEvent.type(input, "{Backspace}");

    expect(shown).toBeInTheDocument();
    expect(screen.queryByText("128 字以内で入力してください")).toBeNull();
  });

  it("TC-UT_P201-003 空のまま送信すると「パスワードを入力してください」を出し、ログインの API を呼ばない", async () => {
    const { mock } = await openLogin({});

    await userEvent.click(screen.getByRole("button", { name: "ログイン" }));

    expect(screen.getByText("パスワードを入力してください")).toBeInTheDocument();
    expect(loginCalls(mock)).toBe(0);
  });

  it("TC-UT_P201-004 送信中はボタンを「確認中…」にして押せなくし、入力欄も無効にする", async () => {
    const { input } = await openLogin({});
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => undefined)),
    );

    await userEvent.type(input, PASSWORD);
    await userEvent.click(screen.getByRole("button", { name: "ログイン" }));

    expect(await screen.findByRole("button", { name: "確認中…" })).toBeDisabled();
    expect(input).toBeDisabled();
  });

  it("TC-UT_P201-005 ログインの 400 VALIDATION_ERROR は fields.password を入力欄の下（様式④）に出す", async () => {
    const { input } = await openLogin({
      "POST /admin/api/login": {
        status: 400,
        body: {
          error: { code: "VALIDATION_ERROR", message: "x", fields: { password: "128 字以内で入力してください" } },
        },
      },
    });

    await userEvent.type(input, PASSWORD);
    await userEvent.click(screen.getByRole("button", { name: "ログイン" }));

    expect(await screen.findByText("128 字以内で入力してください")).toBeInTheDocument();
    expect(input).toHaveAttribute("aria-invalid", "true");
  });

  it("TC-UT_P201-006 画面で扱わない 4xx（403）は、サーバーの message を様式②に出す", async () => {
    const { input } = await openLogin({
      "POST /admin/api/login": {
        status: 403,
        body: { error: { code: "FORBIDDEN_NETWORK", message: "この端末からは開けません" } },
      },
    });

    await userEvent.type(input, PASSWORD);
    await userEvent.click(screen.getByRole("button", { name: "ログイン" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("この端末からは開けません");
  });

  it.each([
    ["fields が HH:MM", new ApiError(429, "LOGIN_LOCKED", "x", { lockedUntil: "10:30" }), "10:30"],
    ["fields が ISO", new ApiError(429, "LOGIN_LOCKED", "x", { lockedUntil: "2026-10-22T01:15:00.000Z" }), "10:15"],
    [
      "message の時刻",
      new ApiError(429, "LOGIN_LOCKED", "ログインの試行が続いたため、11:45 まで受け付けません"),
      "11:45",
    ],
    ["手がかりなし", new ApiError(429, "LOGIN_LOCKED", "ロック中です"), "しばらく"],
    ["message の ISO", new ApiError(429, "LOGIN_LOCKED", "2026-10-22T01:15:00.000Z まで受け付けません"), "10:15"],
    ["fields が時刻でない", new ApiError(429, "LOGIN_LOCKED", "x", { lockedUntil: "まもなく" }), "まもなく"],
    [
      "message の ISO が日付として読めない",
      new ApiError(429, "LOGIN_LOCKED", "2026-13-45T10:00 まで受け付けません"),
      "10:00",
    ],
  ])(
    "TC-UT_P201-007 ロックの解除の時刻は fields・message の順に探し、ISO は JST の HH:MM にし、見つからなければ「しばらく」にする（%s）",
    (_label, error, expected) => {
      const until = extractLockedUntil(error);

      expect(until).toBe(expected);
    },
  );

  it("TC-UT_P201-008 next が「//」で始まる（別のサイトを指す）ときは、ログインの後に / へ移る", async () => {
    const { input, router } = await openLogin(
      {
        "POST /admin/api/login": { status: 200, body: { displayName: "Kaine Yamashiro", csrfToken: "t" } },
        "GET /admin/api/world": worldOk,
        "GET /admin/api/audit-logs": { status: 200, body: { items: [], nextCursor: null } },
      },
      `/login?next=${encodeURIComponent("//evil.example/x")}`,
    );

    await userEvent.type(input, PASSWORD);
    await userEvent.click(screen.getByRole("button", { name: "ログイン" }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
  });

  it("TC-UT_P201-009 ?expired=1 で来たときは「ログインの有効期限が切れました」を様式②の色で出す", async () => {
    await openLogin({}, "/login?expired=1");

    expect(screen.getByRole("alert")).toHaveTextContent("ログインの有効期限が切れました");
  });

  it("TC-UT_P201-010 起動時のセッションの取得が通信の失敗なら様式①を出し、OK で閉じた後は出し直さない", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    renderApp("/login");

    await userEvent.click(await screen.findByRole("button", { name: "OK" }));

    expect(screen.queryByText(SERVER_CONNECT_ERROR_MESSAGE)).toBeNull();
    expect(screen.getByLabelText("パスワード")).toBeInTheDocument();
  });

  it("TC-UT_P201-011 ページのタイトルを「管理ログイン - NOUS」にし、サービス名・見出し・注意書きを出す", async () => {
    await openLogin({});

    expect(document.title).toBe("管理ログイン - NOUS");
    expect(screen.getByText("NOUS 管理")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "管理ログイン" })).toBeInTheDocument();
    expect(screen.getByText("この画面は、システムを動かす端末からだけ開けます")).toBeInTheDocument();
  });

  it("TC-UT_P201-012 パスワードの入力欄で Enter を押すと送信する", async () => {
    const { input, mock } = await openLogin({ "POST /admin/api/login": loginFailed });

    await userEvent.type(input, `${PASSWORD}{Enter}`);

    await waitFor(() => expect(loginCalls(mock)).toBe(1));
  });

  it("TC-UT_P201-013 ログインに 3 回続けて失敗したら「あと 2 回失敗すると 15 分ロックされます」を出す", async () => {
    const { input } = await openLogin({ "POST /admin/api/login": () => loginFailed });

    for (let i = 0; i < 3; i++) {
      await userEvent.clear(input);
      await userEvent.type(input, `${PASSWORD}{Enter}`);
      await screen.findByText(LOGIN_FAILED_MESSAGE);
    }

    expect(await screen.findByText("あと 2 回失敗すると 15 分ロックされます")).toBeInTheDocument();
  });

  it("TC-UT_P201-014 ログインの応答が 200 でも本文が読めなければ様式①（管理サーバーに接続できません）にする", async () => {
    const { input } = await openLogin({});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ status: 200 })),
    );

    await userEvent.type(input, PASSWORD);
    await userEvent.click(screen.getByRole("button", { name: "ログイン" }));

    expect(await screen.findByText(SERVER_CONNECT_ERROR_MESSAGE)).toBeInTheDocument();
  });

  it("TC-UT_P201-015 ログインの 400 で fields がなければ、サーバーの message を入力欄の下に出す", async () => {
    const { input } = await openLogin({
      "POST /admin/api/login": {
        status: 400,
        body: { error: { code: "VALIDATION_ERROR", message: "入力の内容を確認してください" } },
      },
    });

    await userEvent.type(input, PASSWORD);
    await userEvent.click(screen.getByRole("button", { name: "ログイン" }));

    expect(await screen.findByText("入力の内容を確認してください")).toBeInTheDocument();
  });

  it("TC-UT_P201-016 ログインの 409 ADMIN_NOT_SET は、パスワード未設定の案内を様式②に出す", async () => {
    const { input } = await openLogin({
      "POST /admin/api/login": { status: 409, body: { error: { code: "ADMIN_NOT_SET", message: "x" } } },
    });

    await userEvent.type(input, PASSWORD);
    await userEvent.click(screen.getByRole("button", { name: "ログイン" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(ADMIN_NOT_SET_MESSAGE);
  });
});
