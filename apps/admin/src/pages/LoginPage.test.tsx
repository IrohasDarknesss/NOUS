import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockFetch, sessionOk, unauthorized, worldOk } from "../test/fetchMock";
import { renderApp } from "../test/renderApp";
import {
  ADMIN_NOT_SET_MESSAGE,
  LOGIN_FAILED_MESSAGE,
  SERVER_CONNECT_ERROR_MESSAGE,
  validatePassword,
} from "./LoginPage";

afterEach(() => vi.unstubAllGlobals());

describe("P201 LoginPage", () => {
  it("TC-NOUS69_DEV-01 validatePassword は空・12字未満・128字超で所定の文言を返し、12〜128字で null を返す", () => {
    expect(validatePassword("")).toBe("パスワードを入力してください");
    expect(validatePassword("a".repeat(11))).toBe("12 字以上で入力してください");
    expect(validatePassword("a".repeat(12))).toBeNull();
    expect(validatePassword("a".repeat(128))).toBeNull();
    expect(validatePassword("a".repeat(129))).toBe("128 字以内で入力してください");
  });

  it("TC-NOUS69_DEV-02 パスワードの表示切り替えで input の type が password と text に切り替わる", async () => {
    mockFetch({ "GET /admin/api/session": unauthorized });
    renderApp("/login");

    const input = await screen.findByLabelText("パスワード");
    expect(input).toHaveAttribute("type", "password");

    await userEvent.click(screen.getByRole("button", { name: "パスワードの表示の切り替え" }));
    expect(input).toHaveAttribute("type", "text");

    await userEvent.click(screen.getByRole("button", { name: "パスワードの表示の切り替え" }));
    expect(input).toHaveAttribute("type", "password");
  });

  it("TC-NOUS69_DEV-03 ログイン成功で ?next= の遷移先へ移動し、ログイン済みなら / へ移動する", async () => {
    mockFetch({
      "GET /admin/api/session": unauthorized,
      "POST /admin/api/login": {
        status: 200,
        body: { displayName: "Kaine Yamashiro", csrfToken: "csrf-login-ok" },
      },
      "GET /admin/api/world": worldOk,
    });
    const { router, unmount } = renderApp("/login?next=%2Fmetrics");

    const input = await screen.findByLabelText("パスワード");
    await userEvent.type(input, "valid-password-123");
    await userEvent.click(screen.getByRole("button", { name: "ログイン" }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/metrics"));
    unmount();

    mockFetch({ "GET /admin/api/session": sessionOk, "GET /admin/api/world": worldOk });
    const { router: readyRouter } = renderApp("/login");
    await waitFor(() => expect(readyRouter.state.location.pathname).toBe("/"));
  });

  it("TC-NOUS69_DEV-04 ログインの 401 LOGIN_FAILED で「パスワードが正しくありません」を表示する", async () => {
    mockFetch({
      "GET /admin/api/session": unauthorized,
      "POST /admin/api/login": {
        status: 401,
        body: { error: { code: "LOGIN_FAILED", message: LOGIN_FAILED_MESSAGE } },
      },
    });
    renderApp("/login");

    const input = await screen.findByLabelText("パスワード");
    await userEvent.type(input, "wrong-password-123");
    await userEvent.click(screen.getByRole("button", { name: "ログイン" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(LOGIN_FAILED_MESSAGE);
  });

  it("TC-NOUS69_DEV-05 ログインの 429 LOGIN_LOCKED で解除の時刻を含むロックの文言を表示する", async () => {
    mockFetch({
      "GET /admin/api/session": unauthorized,
      "POST /admin/api/login": {
        status: 429,
        body: {
          error: {
            code: "LOGIN_LOCKED",
            message: "ログインの試行が続いたため、14:35 まで受け付けません",
            fields: { lockedUntil: "14:35" },
          },
        },
      },
    });
    renderApp("/login");

    const input = await screen.findByLabelText("パスワード");
    await userEvent.type(input, "locked-password-123");
    await userEvent.click(screen.getByRole("button", { name: "ログイン" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("ログインの試行が続いたため、14:35 まで受け付けません");
  });

  it("TC-NOUS69_DEV-06 パスワード未設定（409 ADMIN_NOT_SET）で設定手順の案内を表示する", async () => {
    mockFetch({
      "GET /admin/api/session": {
        status: 409,
        body: { error: { code: "ADMIN_NOT_SET", message: "未設定" } },
      },
    });
    renderApp("/login");

    expect(await screen.findByRole("alert")).toHaveTextContent(ADMIN_NOT_SET_MESSAGE);
  });

  it("TC-NOUS69_DEV-07 ログイン時の通信失敗・500 エラーは様式①（ErrorModal）で表示する", async () => {
    mockFetch({
      "GET /admin/api/session": unauthorized,
      "POST /admin/api/login": {
        status: 500,
        body: { error: { code: "INTERNAL_ERROR", message: "error" } },
      },
    });
    renderApp("/login");

    const input = await screen.findByLabelText("パスワード");
    await userEvent.type(input, "valid-password-123");
    await userEvent.click(screen.getByRole("button", { name: "ログイン" }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent(SERVER_CONNECT_ERROR_MESSAGE);
  });
});
