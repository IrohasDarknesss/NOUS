// 単体テスト（NOUS-106）。観点表は docs/test/unit/NOUS-106/観点表_layout_components.json
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { agentMika, makePost } from "../test/observerUt";
import { AgentName } from "./AgentName";
import { EmptyState } from "./EmptyState";
import { FullPageError } from "./FullPageError";
import { LoadMoreButton } from "./LoadMoreButton";
import { PostCard } from "./PostCard";

const inRouter = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

afterEach(() => {
  cleanup();
});

describe("components（単体テスト）", () => {
  it("TC-UT_OWEB-054 AgentName は linked=false なら表示名をリンクにしない", () => {
    inRouter(<AgentName agent={agentMika} linked={false} />);

    expect(screen.getByText("ミカ")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("TC-UT_OWEB-055 AgentName のリンクは agentId をエンコードしたプロフィールへのパスにする", () => {
    inRouter(<AgentName agent={{ ...agentMika, agentId: "a/b" }} />);

    expect(screen.getByRole("link", { name: "ミカ" })).toHaveAttribute("href", "/agents/a%2Fb");
  });

  it("TC-UT_OWEB-056 AgentName は state が active なら停止中のバッジを出さない", () => {
    inRouter(<AgentName agent={agentMika} />);

    expect(screen.queryByText("停止中")).not.toBeInTheDocument();
  });

  it.each(["Enter", " "])(
    "TC-UT_OWEB-057 PostCard にフォーカスして Enter・スペースを押すと onOpen を呼ぶ（%j）",
    (key) => {
      const onOpen = vi.fn();
      inRouter(<PostCard post={makePost("P1")} onOpen={onOpen} />);

      fireEvent.keyDown(screen.getByRole("link", { name: /本文 P1/ }), { key });

      expect(onOpen).toHaveBeenCalledWith("P1");
    },
  );

  it("TC-UT_OWEB-058 PostCard は Enter・スペース以外のキーや、中の要素から来たキーでは onOpen を呼ばない", () => {
    const onOpen = vi.fn();
    inRouter(<PostCard post={makePost("P1")} onOpen={onOpen} />);

    fireEvent.keyDown(screen.getByRole("link", { name: /本文 P1/ }), { key: "a" });
    fireEvent.keyDown(screen.getByRole("link", { name: "ミカ" }), { key: "Enter" });

    expect(onOpen).not.toHaveBeenCalled();
  });

  it("TC-UT_OWEB-059 PostCard は返信でなければ返信先を出さず、時刻を「第 N 日 HH:MM」で出す", () => {
    inRouter(<PostCard post={makePost("P1", { worldTimeSec: 86400 + 3600 })} onOpen={() => {}} />);

    expect(screen.queryByText(/返信先：/)).not.toBeInTheDocument();
    expect(screen.getByText("第 2 日 01:00")).toBeInTheDocument();
  });

  it("TC-UT_OWEB-060 PostCard の中には押せる部品（button）を置かない", () => {
    inRouter(<PostCard post={makePost("P1", { likeCount: 5, replyCount: 3 })} onOpen={() => {}} />);

    const card = screen.getByRole("link", { name: /本文 P1/ });

    expect(within(card).queryAllByRole("button")).toHaveLength(0);
    expect(within(card).getByText("いいね 5")).toBeInTheDocument();
  });

  it("TC-UT_OWEB-061 LoadMoreButton は読み込み中でなければ「さらに読み込む」で押せ、押すと onClick を呼ぶ", () => {
    const onClick = vi.fn();
    render(<LoadMoreButton onClick={onClick} loading={false} />);

    fireEvent.click(screen.getByRole("button", { name: "さらに読み込む" }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("TC-UT_OWEB-062 FullPageError は linkToTimeline=false ならタイムラインへのリンクを出さない", () => {
    inRouter(<FullPageError title="ページが見つかりません" linkToTimeline={false} />);

    expect(screen.getByRole("heading", { name: "ページが見つかりません" })).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("TC-UT_OWEB-063 EmptyState は渡された文言をそのまま出す", () => {
    render(<EmptyState message="まだ投稿はありません" />);

    expect(screen.getByText("まだ投稿はありません")).toBeInTheDocument();
  });
});
