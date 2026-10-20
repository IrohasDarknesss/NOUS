import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { PostView } from "../api/types";
import { AgentName } from "./AgentName";
import { LoadMoreButton } from "./LoadMoreButton";
import { PostCard } from "./PostCard";

const agent = { agentId: "01A", handle: "mika", displayName: "ミカ", isAi: true as const, state: "active" as const };

const post: PostView = {
  postId: "01P",
  body: "<b>太字にしない</b>\n二行目",
  worldTimeSec: 3600,
  agent,
  replyTo: { postId: "01R", handle: "ren", displayName: "レン" },
  replyCount: 0,
  likeCount: 0,
};

describe("共通部品", () => {
  it("TC-NOUS49_DEV-17 AgentName は AI バッジとハンドルを出し、停止中なら停止中のバッジも出す", () => {
    const { rerender } = render(<AgentName agent={agent} />, { wrapper: MemoryRouter });
    expect(screen.getByText("AI")).toBeInTheDocument();
    expect(screen.getByText("@mika")).toBeInTheDocument();
    expect(screen.queryByText("停止中")).not.toBeInTheDocument();
    rerender(<AgentName agent={{ ...agent, state: "stopped" }} />);
    expect(screen.getByText("停止中")).toBeInTheDocument();
  });

  it("TC-NOUS49_DEV-18 PostCard は本文をテキストのまま描き、返信先・返信 0・いいね 0 を出す", () => {
    const { container } = render(<PostCard post={post} onOpen={() => {}} />, { wrapper: MemoryRouter });
    expect(container.querySelector("b")).toBeNull();
    expect(screen.getByText(/<b>太字にしない<\/b>/)).toBeInTheDocument();
    expect(screen.getByText("返信先：レン")).toBeInTheDocument();
    expect(screen.getByText("返信 0")).toBeInTheDocument();
    expect(screen.getByText("いいね 0")).toBeInTheDocument();
    expect(screen.getByText("第 1 日 01:00")).toBeInTheDocument();
  });

  it("TC-NOUS49_DEV-19 PostCard を押すと onOpen、表示名を押しても onOpen は呼ばない", () => {
    const onOpen = vi.fn();
    render(<PostCard post={post} onOpen={onOpen} />, { wrapper: MemoryRouter });
    fireEvent.click(screen.getByText("ミカ"));
    expect(onOpen).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("返信 0"));
    expect(onOpen).toHaveBeenCalledWith("01P");
  });

  it("TC-NOUS49_DEV-20 LoadMoreButton は読み込み中に押せない", () => {
    render(<LoadMoreButton onClick={() => {}} loading />);
    expect(screen.getByRole("button", { name: "読み込み中…" })).toBeDisabled();
  });
});
