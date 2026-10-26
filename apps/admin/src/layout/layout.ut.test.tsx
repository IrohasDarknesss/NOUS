// 単体テスト（NOUS-99）。観点表は docs/test/unit/NOUS-99/観点表_AWEB_ui.json
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockFetch, sessionOk, unauthorized, worldOk } from "../test/fetchMock";
import { renderApp } from "../test/renderApp";
import { formatStopReason, WorldStateBadge } from "./WorldStateBadge";
import { formatWorldTime } from "./worldTime";

afterEach(() => vi.unstubAllGlobals());

describe("layout（単体テスト）", () => {
  it.each([
    [-5, "第 1 日 00:00"],
    [59.9, "第 1 日 00:00"],
    [3599, "第 1 日 00:59"],
    [3600, "第 1 日 01:00"],
  ])("TC-UT_AWEB-021 世界内時間は負なら 0 として扱い、秒の端数と 1 分未満は切り捨てる（%j）", (sec, expected) => {
    const text = formatWorldTime(sec);

    expect(text).toBe(expected);
  });

  it("TC-UT_AWEB-022 formatStopReason は知らない理由をそのまま返し、undefined は空にする", () => {
    const unknown = formatStopReason("maintenance");
    const empty = formatStopReason(undefined);

    expect(unknown).toBe("maintenance");
    expect(empty).toBe("");
  });

  it("TC-UT_AWEB-023 WorldStateBadge は上限停止以外では停止理由を添えない", () => {
    render(
      <>
        <WorldStateBadge state="paused" stopReason="manual_pause" />
        <WorldStateBadge state="emergency_stopped" stopReason="emergency" />
      </>,
    );

    expect(screen.getByText("一時停止")).toBeInTheDocument();
    expect(screen.getByText("緊急停止")).toBeInTheDocument();
    expect(screen.queryByText(/（/)).toBeNull();
  });

  it("TC-UT_AWEB-024 サイドメニューは /agents で「エージェント」だけを現在の画面にし、「実行制御」（/）は強調しない", async () => {
    mockFetch({
      "GET /admin/api/session": sessionOk,
      "GET /admin/api/world": worldOk,
      "GET /admin/api/agents": { status: 200, body: { items: [], nextCursor: null } },
    });

    renderApp("/agents");

    const nav = await screen.findByRole("navigation", { name: "管理メニュー" });
    const agents = await waitFor(() => {
      const link = nav.querySelector('a[href="/agents"]');
      expect(link).not.toBeNull();
      return link as HTMLElement;
    });
    expect(agents).toHaveAttribute("aria-current", "page");
    expect(nav.querySelector('a[href="/"]')).not.toHaveAttribute("aria-current");
  });

  it("TC-UT_AWEB-025 ヘッダーは世界の状態の取得中に「状態を取得しています…」を出し、ログインした管理者の表示名を出す", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.startsWith("/admin/api/session")) {
          return new Response(JSON.stringify(sessionOk.body), { status: 200 });
        }
        return new Promise<Response>(() => undefined);
      }),
    );

    renderApp("/");

    expect(await screen.findByText("状態を取得しています…")).toBeInTheDocument();
    expect(screen.getByText("Kaine Yamashiro")).toBeInTheDocument();
  });

  it("TC-UT_AWEB-026 画面の API が 401 なら様式①を出し、OK でセッションを捨てて /login の画面に移る", async () => {
    mockFetch({
      "GET /admin/api/session": sessionOk,
      "GET /admin/api/world": worldOk,
      "GET /admin/api/settings": unauthorized,
    });
    const { router } = renderApp("/settings");

    const ok = await screen.findByRole("button", { name: "OK" });
    expect(screen.getByText("ログインの有効期限が切れました。もう一度ログインしてください")).toBeInTheDocument();
    await userEvent.click(ok);

    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    expect(await screen.findByRole("heading", { name: "管理ログイン" })).toBeInTheDocument();
  });

  it("TC-UT_AWEB-038 移動先のない様式①（500）は、OK で閉じてもセッションを捨てず、同じ画面に残る", async () => {
    mockFetch({
      "GET /admin/api/session": sessionOk,
      "GET /admin/api/world": worldOk,
      "GET /admin/api/settings": { status: 500, body: { error: { code: "INTERNAL_ERROR", message: "x" } } },
    });
    const { router } = renderApp("/settings");

    await userEvent.click(await screen.findByRole("button", { name: "OK" }));

    expect(screen.queryByText("設定を取得できませんでした")).toBeNull();
    expect(router.state.location.pathname).toBe("/settings");
    expect(screen.getByRole("button", { name: "ログアウト" })).toBeInTheDocument();
  });
});
