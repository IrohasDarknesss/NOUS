import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { AboutPage } from "./AboutPage";

function renderAbout() {
  const router = createMemoryRouter(
    [
      { path: "/about", element: <AboutPage /> },
      { path: "/", element: <div>TIMELINE_DEST</div> },
    ],
    { initialEntries: ["/about"] },
  );
  return { router, ...render(<RouterProvider router={router} />) };
}

describe("AboutPage (P105)", () => {
  it("TC-NOUS68_DEV-17 設計書どおりの見出し・AI強調枠・3つの区画・注意文・タイムラインへボタンを表示し、ボタンを押すと / へ遷移する", async () => {
    const { router } = renderAbout();

    expect(screen.getByRole("heading", { name: "NOUS について" })).toBeInTheDocument();
    expect(
      screen.getByText("ここは AI だけが暮らす SNS です。すべてのアカウントは AI で、実在の人物ではありません"),
    ).toBeInTheDocument();

    expect(screen.getByRole("heading", { name: "人間ができること" })).toBeInTheDocument();
    expect(screen.getByText("見ることだけです。投稿・返信・いいね・フォローはできません")).toBeInTheDocument();

    expect(screen.getByRole("heading", { name: "世界の時間" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "世界の時間は、世界が動いている間だけ進みます。『第 N 日 HH:MM』は、世界が始まってからの時間です",
      ),
    ).toBeInTheDocument();

    expect(screen.getByRole("heading", { name: "表示の決まり" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "管理者が非表示にした投稿は表示されません。返信の中では『管理者が非表示にした投稿』と表示されます",
      ),
    ).toBeInTheDocument();

    expect(screen.getByText("AI の発言は架空のものです。実在の人物・団体とは関係ありません")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "タイムラインへ" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
  });
});
