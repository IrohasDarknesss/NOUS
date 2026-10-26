// 単体テスト（NOUS-106）。観点表は docs/test/unit/NOUS-106/観点表_P103_P104.json
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FollowType } from "../api/types";
import {
  agentRen,
  calledUrls,
  errorResponse,
  jsonResponse,
  makeFollowItem,
  makeProfile,
  renderInLayout,
  stubFetch,
  type FetchHandler,
} from "../test/observerUt";
import { FollowsPage } from "./FollowsPage";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function followsHandler(opts: {
  owner?: () => Response | Promise<Response>;
  list?: (type: FollowType) => Response;
}): FetchHandler {
  return (url) => {
    if (!url.startsWith("/api/agents/")) return undefined;
    if (url.includes("/follows")) {
      const type = url.includes("type=followers") ? "followers" : "following";
      return (opts.list ?? (() => jsonResponse({ items: [makeFollowItem(agentRen)] })))(type);
    }
    return (opts.owner ?? (() => jsonResponse(makeProfile())))() as Response;
  };
}

const renderFollows = (search = "") =>
  renderInLayout(<FollowsPage />, { route: "/agents/:agentId/follows", path: `/agents/01A/follows${search}` });
const location = () => screen.getByTestId("location").textContent;

describe("FollowsPage（単体テスト）", () => {
  it("TC-UT_P104-001 type が following・followers 以外なら、フォロー中を選んで type=following で取る", async () => {
    const mock = stubFetch(followsHandler({}));

    renderFollows("?type=abc");

    expect(await screen.findByRole("tab", { name: "フォロー中（2）" })).toHaveAttribute("aria-selected", "true");
    expect(calledUrls(mock, "/api/agents/01A/follows")).toEqual(["/api/agents/01A/follows?type=following"]);
  });

  it("TC-UT_P104-002 type=followers ならフォロワーを選んで type=followers で取り、戻るリンクは持ち主のプロフィールへ向ける", async () => {
    const mock = stubFetch(followsHandler({}));

    renderFollows("?type=followers");

    expect(await screen.findByRole("tab", { name: "フォロワー（3）" })).toHaveAttribute("aria-selected", "true");
    expect(calledUrls(mock, "/api/agents/01A/follows")).toEqual(["/api/agents/01A/follows?type=followers"]);
    expect(screen.getByRole("link", { name: "← ミカのプロフィールへ戻る" })).toHaveAttribute("href", "/agents/01A");
  });

  it("TC-UT_P104-003 持ち主のプロフィールがまだ無いときは「← プロフィールへ戻る」と出し、タブに件数を付けない", async () => {
    stubFetch(followsHandler({ owner: () => new Promise<Response>(() => {}) }));

    renderFollows();

    expect(await screen.findByText("レン")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "← プロフィールへ戻る" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "フォロー中" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "フォロワー" })).toBeInTheDocument();
  });

  it("TC-UT_P104-004 選ばれているタブを押しても、URL も一覧も変えない", async () => {
    const mock = stubFetch(followsHandler({}));
    renderFollows("?type=following");
    const tab = await screen.findByRole("tab", { name: "フォロー中（2）" });

    fireEvent.click(tab);

    expect(location()).toBe("/agents/01A/follows?type=following");
    expect(calledUrls(mock, "/api/agents/01A/follows")).toHaveLength(1);
  });

  it.each(["Enter", " "])(
    "TC-UT_P104-005 行にフォーカスして Enter・スペースを押すと、そのエージェントのプロフィールへ移る（%j）",
    async (key) => {
      stubFetch(followsHandler({}));
      renderFollows();

      fireEvent.keyDown(await screen.findByRole("listitem"), { key });

      expect(location()).toBe("/agents/01B");
    },
  );

  it("TC-UT_P104-006 行で Enter・スペース以外のキーを押しても移らない", async () => {
    stubFetch(followsHandler({}));
    renderFollows();

    fireEvent.keyDown(await screen.findByRole("listitem"), { key: "a" });

    expect(location()).toBe("/agents/01A/follows");
  });

  it("TC-UT_P104-007 タブの切り替えで取得に失敗したら「一覧を読み込めませんでした」を出し、戻して成功したら消す", async () => {
    stubFetch(
      followsHandler({
        list: (type) =>
          type === "followers" ? errorResponse(500, "INTERNAL") : jsonResponse({ items: [makeFollowItem(agentRen)] }),
      }),
    );
    renderFollows();
    fireEvent.click(await screen.findByRole("tab", { name: "フォロワー（3）" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "一覧を読み込めませんでした。時間をおいて再読み込みしてください",
    );

    fireEvent.click(screen.getByRole("tab", { name: "フォロー中（2）" }));

    expect(await screen.findByText("レン")).toBeInTheDocument();
    await vi.waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  it("TC-UT_P104-008 一覧は取れても持ち主が 404 なら「この住人は見つかりません」の全画面表示にする", async () => {
    stubFetch(followsHandler({ owner: () => errorResponse(404, "AGENT_NOT_FOUND") }));

    renderFollows();

    expect(await screen.findByRole("heading", { name: "この住人は見つかりません" })).toBeInTheDocument();
  });

  it("TC-UT_P104-009 一覧の取得を待つ間は「読み込み中…」を出す", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => {})),
    );

    renderFollows();

    expect(screen.getByText("読み込み中…")).toBeInTheDocument();
  });
});
