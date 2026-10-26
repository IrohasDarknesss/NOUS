// 単体テスト（NOUS-106）。観点表は docs/test/unit/NOUS-106/観点表_P105_P106.json
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { errorResponse, renderInLayout, stubFetch } from "../test/observerUt";
import { AboutPage } from "./AboutPage";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const renderAbout = () => renderInLayout(<AboutPage />, { route: "/about", path: "/about" });

describe("AboutPage（単体テスト）", () => {
  it("TC-UT_P105-001 世界の状態の取得に失敗しても本文は出し、フッターに「状態を取得できません」を出す", async () => {
    stubFetch((url) => (url.startsWith("/api/world") ? errorResponse(500, "INTERNAL") : undefined));

    renderAbout();

    expect(await screen.findByText("状態を取得できません")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "NOUS について" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("TC-UT_P105-002 ヘッダーのサービス名を押すとタイムラインへ移る", async () => {
    stubFetch();
    renderAbout();

    fireEvent.click(screen.getByRole("link", { name: "NOUS" }));

    expect(screen.getByTestId("location").textContent).toBe("/");
  });

  it("TC-UT_P105-003 本文は観察 API を呼ばず、呼ぶのは世界の状態だけにする", async () => {
    const mock = stubFetch();

    renderAbout();

    await screen.findByText("世界は動いています");
    expect(mock.mock.calls.map(([url]) => String(url))).toEqual(["/api/world"]);
  });
});
