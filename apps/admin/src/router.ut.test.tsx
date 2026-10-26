// 単体テスト（NOUS-99）。観点表は docs/test/unit/NOUS-99/観点表_AWEB_api.json
import { screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockFetch, unauthorized } from "./test/fetchMock";
import { renderApp } from "./test/renderApp";

afterEach(() => vi.unstubAllGlobals());

describe("router（単体テスト）", () => {
  it("TC-UT_AWEB-020 未ログインで検索文字列つきの画面を開くと、検索文字列も含めて next に入れて /login へ移る", async () => {
    mockFetch({ "GET /admin/api/session": unauthorized });

    const { router } = renderApp("/generations?status=failed");

    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    expect(router.state.location.search).toBe(`?next=${encodeURIComponent("/generations?status=failed")}`);
    expect(await screen.findByRole("heading", { name: "管理ログイン" })).toBeInTheDocument();
  });
});
