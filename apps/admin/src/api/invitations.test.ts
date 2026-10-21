import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setCsrfToken } from "../session/csrfToken";
import { mockFetch } from "../test/fetchMock";
import { issueInvitation, listInvitations, revokeInvitation } from "./invitations";

describe("api/invitations", () => {
  beforeEach(() => setCsrfToken("csrf-inv"));
  afterEach(() => {
    vi.unstubAllGlobals();
    setCsrfToken(null);
  });

  it("TC-NOUS72_DEV-04 listInvitations は GET /admin/api/invitations を呼ぶ", async () => {
    const mock = mockFetch({
      "GET /admin/api/invitations": {
        status: 200,
        body: { items: [], lanAddress: "192.168.1.10" },
      },
    });

    const res = await listInvitations();
    expect(res).toEqual({ items: [], lanAddress: "192.168.1.10" });
    expect(mock.mock.calls[0]?.[0]).toBe("/admin/api/invitations");
    expect(mock.mock.calls[0]?.[1]?.method).toBe("GET");
  });

  it("TC-NOUS72_DEV-05 issueInvitation は POST /admin/api/invitations に label を送り、revokeInvitation は invitationId をエンコードして POST する", async () => {
    const mock = mockFetch({
      "POST /admin/api/invitations": {
        status: 201,
        body: {
          invitationId: "01JINV00000000000000000001",
          inviteUrl: "http://192.168.1.10:8080/invite/token-1",
        },
      },
      "POST /admin/api/invitations/inv%2F1/revoke": {
        status: 200,
        body: {
          invitationId: "inv/1",
          revokedAt: "2026-10-22T06:00:00.000Z",
        },
      },
    });

    const created = await issueInvitation({ label: "たなか" });
    expect(created.inviteUrl).toBe("http://192.168.1.10:8080/invite/token-1");
    expect(mock.mock.calls[0]?.[0]).toBe("/admin/api/invitations");
    expect(mock.mock.calls[0]?.[1]?.method).toBe("POST");
    expect(mock.mock.calls[0]?.[1]?.body).toBe(JSON.stringify({ label: "たなか" }));

    const revoked = await revokeInvitation("inv/1");
    expect(revoked).toEqual({
      invitationId: "inv/1",
      revokedAt: "2026-10-22T06:00:00.000Z",
    });
    expect(mock.mock.calls[1]?.[0]).toBe("/admin/api/invitations/inv%2F1/revoke");
    expect(mock.mock.calls[1]?.[1]?.method).toBe("POST");
  });
});
