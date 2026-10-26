// 単体テスト（NOUS-106）。観点表は docs/test/unit/NOUS-106/観点表_P105_P106.json
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { NotInvitedPage } from "./NotInvitedPage";

afterEach(() => {
  cleanup();
  document.head.querySelectorAll('meta[name="robots"]').forEach((el) => el.remove());
  document.title = "";
});

describe("NotInvitedPage（単体テスト）", () => {
  it("TC-UT_P106-001 離れるときにページのタイトルを元に戻し、自分で足した meta robots を消す", () => {
    document.title = "NOUS";
    const { unmount } = render(<NotInvitedPage />);
    const during = {
      title: document.title,
      robots: document.head.querySelector('meta[name="robots"]')?.getAttribute("content"),
    };

    unmount();

    expect(during).toEqual({ title: "閲覧できません - NOUS", robots: "noindex" });
    expect(document.title).toBe("NOUS");
    expect(document.head.querySelector('meta[name="robots"]')).toBeNull();
  });

  it("TC-UT_P106-002 meta robots が元からあれば、表示中は noindex にし、離れるときに元の値へ戻す", () => {
    const meta = document.createElement("meta");
    meta.setAttribute("name", "robots");
    meta.setAttribute("content", "index,follow");
    document.head.appendChild(meta);
    const { unmount } = render(<NotInvitedPage />);
    const during = meta.getAttribute("content");

    unmount();

    expect(during).toBe("noindex");
    expect(meta.getAttribute("content")).toBe("index,follow");
    expect(document.head.querySelectorAll('meta[name="robots"]')).toHaveLength(1);
  });
});
