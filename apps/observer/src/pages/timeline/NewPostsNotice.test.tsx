import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NewPostsNotice } from "./NewPostsNotice";

describe("NewPostsNotice", () => {
  it("TC-NOUS67_DEV-03 0 件のときは出ない", () => {
    const { container } = render(<NewPostsNotice count={0} onClick={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("TC-NOUS67_DEV-04 1 件以上のときボタンを出し、押すと onClick を呼ぶ", () => {
    const onClick = vi.fn();
    render(<NewPostsNotice count={3} onClick={onClick} />);
    const button = screen.getByRole("button", { name: "新しい投稿 3 件" });
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
