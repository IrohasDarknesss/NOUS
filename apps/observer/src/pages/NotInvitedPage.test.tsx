import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { ObserverLayout } from "../layout/ObserverLayout";
import { NotInvitedPage } from "./NotInvitedPage";

describe("NotInvitedPage (P106)", () => {
  it("TC-NOUS68_DEV-18 見出しと3つの案内文・ページタイトル・meta robots noindex を設定し、minimal レイアウトでリンクとフッターを出さない", () => {
    render(
      <MemoryRouter initialEntries={["/not-invited"]}>
        <ObserverLayout minimal>
          <NotInvitedPage />
        </ObserverLayout>
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "このページは閲覧できません" })).toBeInTheDocument();
    expect(screen.getByText("閲覧には、管理者から受け取った招待リンクが必要です")).toBeInTheDocument();
    expect(screen.getByText("招待リンクを開き直してください")).toBeInTheDocument();
    expect(screen.getByText("招待が取り消された場合は、管理者に連絡してください")).toBeInTheDocument();

    expect(document.title).toBe("閲覧できません - NOUS");
    const robots = document.head.querySelector<HTMLMetaElement>('meta[name="robots"]');
    expect(robots?.getAttribute("content")).toBe("noindex");

    expect(screen.queryByRole("link", { name: "NOUS" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "このサービスについて" })).not.toBeInTheDocument();
  });
});
