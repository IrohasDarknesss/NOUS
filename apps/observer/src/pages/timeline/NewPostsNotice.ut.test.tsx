// 単体テスト（NOUS-106）。観点表は docs/test/unit/NOUS-106/観点表_P101_P102.json
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { NewPostsNotice } from "./NewPostsNotice";

afterEach(() => {
  cleanup();
});

describe("NewPostsNotice（単体テスト）", () => {
  it("TC-UT_P101-012 件数が負の値なら通知を出さない", () => {
    render(<NewPostsNotice count={-1} onClick={() => {}} />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
