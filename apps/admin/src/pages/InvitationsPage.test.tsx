import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockFetch, sessionOk, worldOk } from "../test/fetchMock";
import { renderApp } from "../test/renderApp";
import { COPY_FEEDBACK_MS } from "./invitations/IssuedLinkBox";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  localStorage.clear();
  sessionStorage.clear();
});

const invitationsBody = {
  items: [
    {
      invitationId: "01JINV00000000000000000001",
      label: "たなか",
      issuedAt: "2026-10-22T05:00:00.000Z",
      revokedAt: null,
      lastUsedAt: "2026-10-22T06:30:00.000Z",
    },
    {
      invitationId: "01JINV00000000000000000002",
      label: "すずき",
      issuedAt: "2026-10-21T01:00:00.000Z",
      revokedAt: "2026-10-21T02:00:00.000Z",
      lastUsedAt: null,
    },
  ],
  lanAddress: "192.168.1.10",
};

describe("InvitationsPage (P210)", () => {
  it("TC-NOUS72_DEV-12 P210 表示名が前後の空白を除いて 1〜30 字でなければ「1〜30 字で入力してください」を表示する", async () => {
    const fetchMock = mockFetch({
      "GET /admin/api/session": sessionOk,
      "GET /admin/api/world": worldOk,
      "GET /admin/api/invitations": { status: 200, body: invitationsBody },
    });

    renderApp("/invitations");
    expect(await screen.findByText("たなか")).toBeInTheDocument();

    const input = screen.getByLabelText("表示名");
    await userEvent.type(input, "   ");
    await userEvent.click(screen.getByRole("button", { name: "招待リンクを発行" }));
    expect(screen.getByRole("alert")).toHaveTextContent("1〜30 字で入力してください");

    await userEvent.clear(input);
    await userEvent.type(input, "あ".repeat(31));
    await userEvent.click(screen.getByRole("button", { name: "招待リンクを発行" }));
    expect(screen.getByRole("alert")).toHaveTextContent("1〜30 字で入力してください");

    expect(
      fetchMock.mock.calls.some(([url, init]) => String(url) === "/admin/api/invitations" && init?.method === "POST"),
    ).toBe(false);
  });

  it("TC-NOUS72_DEV-13 P210 発行直後だけ招待 URL を表示して入力欄を空にし、コピーで 2 秒間「コピーしました」を出し、localStorage・sessionStorage・URL には保存しない", async () => {
    const inviteUrl = "http://192.168.1.10:8080/invite/secret-token-xyz";
    mockFetch({
      "GET /admin/api/session": sessionOk,
      "GET /admin/api/world": worldOk,
      "GET /admin/api/invitations": { status: 200, body: invitationsBody },
      "POST /admin/api/invitations": {
        status: 201,
        body: {
          invitationId: "01JINV00000000000000000003",
          inviteUrl,
        },
      },
    });

    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    const { router, queryClient } = renderApp("/invitations");
    await screen.findByText("たなか");

    const input = screen.getByLabelText("表示名");
    await userEvent.type(input, "さとう");
    await userEvent.click(screen.getByRole("button", { name: "招待リンクを発行" }));

    expect(await screen.findByText(inviteUrl)).toBeInTheDocument();
    expect(screen.getByText("このリンクは今だけ表示されます。招待する人に直接渡してください")).toBeInTheDocument();
    expect(input).toHaveValue("");

    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(router.state.location.search).toBe("");
    expect(JSON.stringify(queryClient.getQueryData(["admin", "invitations"]))).not.toContain("secret-token-xyz");

    vi.useFakeTimers({ shouldAdvanceTime: true });
    await userEvent.click(screen.getByRole("button", { name: "コピー" }));
    expect(writeText).toHaveBeenCalledWith(inviteUrl);
    expect(screen.getByText("コピーしました")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(COPY_FEEDBACK_MS);
    });
    expect(screen.queryByText("コピーしました")).toBeNull();
  });

  it("TC-NOUS72_DEV-14 P210 招待 URL の表示中に画面を離れようとすると確認ダイアログを出し、移動すると URL は消える", async () => {
    const inviteUrl = "http://192.168.1.10:8080/invite/token-leave-guard";
    mockFetch({
      "GET /admin/api/session": sessionOk,
      "GET /admin/api/world": worldOk,
      "GET /admin/api/invitations": { status: 200, body: invitationsBody },
      "POST /admin/api/invitations": {
        status: 201,
        body: {
          invitationId: "01JINV00000000000000000004",
          inviteUrl,
        },
      },
    });

    const { router } = renderApp("/invitations");
    await screen.findByText("たなか");

    await userEvent.type(screen.getByLabelText("表示名"), "かとう");
    await userEvent.click(screen.getByRole("button", { name: "招待リンクを発行" }));
    expect(await screen.findByText(inviteUrl)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("link", { name: "実行制御" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("招待リンクはもう表示できません。コピーしましたか");

    await userEvent.click(within(dialog).getByRole("button", { name: "キャンセル" }));
    expect(router.state.location.pathname).toBe("/invitations");
    expect(screen.getByText(inviteUrl)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("link", { name: "実行制御" }));
    const dialog2 = await screen.findByRole("dialog");
    await userEvent.click(within(dialog2).getByRole("button", { name: "移動する" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));

    await userEvent.click(screen.getByRole("link", { name: "閲覧アクセス" }));
    await screen.findByText("たなか");
    expect(screen.queryByText(inviteUrl)).toBeNull();
  });

  it("TC-NOUS72_DEV-15 P210 失効の確認で確定すると revoke を呼んでトーストを出し、409 ALREADY_REVOKED・LAN_ADDRESS_NOT_FOUND は様式②を表示する", async () => {
    let revokeStatus = 200;
    mockFetch({
      "GET /admin/api/session": sessionOk,
      "GET /admin/api/world": worldOk,
      "GET /admin/api/invitations": { status: 200, body: invitationsBody },
      "POST /admin/api/invitations": {
        status: 409,
        body: { error: { code: "LAN_ADDRESS_NOT_FOUND", message: "LAN なし" } },
      },
      "POST /admin/api/invitations/01JINV00000000000000000001/revoke": () =>
        revokeStatus === 200
          ? {
              status: 200,
              body: {
                invitationId: "01JINV00000000000000000001",
                revokedAt: "2026-10-22T07:00:00.000Z",
              },
            }
          : {
              status: 409,
              body: { error: { code: "ALREADY_REVOKED", message: "失効済み" } },
            },
    });

    const { queryClient } = renderApp("/invitations");
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    await screen.findByText("たなか");

    const revokeButtons = screen.getAllByRole("button", { name: "失効させる" });
    expect(revokeButtons).toHaveLength(1);
    await userEvent.click(revokeButtons[0]!);

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("失効させますか。この招待では見られなくなります");
    await userEvent.click(within(dialog).getByRole("button", { name: "失効させる" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByText("失効させました。次の閲覧から見られなくなります")).toBeInTheDocument();
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["admin", "invitations"] });

    revokeStatus = 409;
    await userEvent.click(screen.getByRole("button", { name: "失効させる" }));
    const dialog2 = screen.getByRole("dialog");
    await userEvent.click(within(dialog2).getByRole("button", { name: "失効させる" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("この招待はすでに失効しています");

    await userEvent.type(screen.getByLabelText("表示名"), "やまだ");
    await userEvent.click(screen.getByRole("button", { name: "招待リンクを発行" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "この端末の LAN のアドレスが見つかりません。端末がネットワークにつながっているか確かめてください",
    );
  });

  it("TC-NOUS72_DEV-16 P210 lanAddress が null のときは警告「ネットワークにつながっていません」を出し、日時は JST の YYYY/MM/DD HH:MM、null は「―」で表示する", async () => {
    mockFetch({
      "GET /admin/api/session": sessionOk,
      "GET /admin/api/world": worldOk,
      "GET /admin/api/invitations": {
        status: 200,
        body: { ...invitationsBody, lanAddress: null },
      },
    });

    renderApp("/invitations");
    expect(await screen.findByText("ネットワークにつながっていません")).toBeInTheDocument();
    expect(screen.getByText("2026/10/22 14:00")).toBeInTheDocument();
    expect(screen.getByText("2026/10/22 15:30")).toBeInTheDocument();
    expect(screen.getAllByText("―").length).toBeGreaterThanOrEqual(1);
  });
});
