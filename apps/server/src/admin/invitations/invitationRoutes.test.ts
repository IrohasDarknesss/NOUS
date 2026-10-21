import os from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TEST_NOW, captureLogger, seedAdmin, seedSession } from "../../../test/helpers/adminTestSupport";
import { createTestDb, type TestDb } from "../../../test/helpers/testDb";
import { FakeClock } from "../../clock/fakeClock";
import { admin_audit_logs, invitations } from "../../db/schema";
import { sha256Hex } from "../../lib/tokens";
import { createAdminApp } from "../adminServer";
import { CSRF_HEADER } from "../middleware/csrf";
import { ADMIN_COOKIE } from "../middleware/sessionAuth";
import { MAX_ACTIVE_INVITATIONS_MESSAGE } from "./invitationService";

describe("invitationRoutes", () => {
  let t: TestDb;
  let clock: FakeClock;
  let session: { cookie: string; csrfToken: string; sessionHash: string };

  beforeEach(() => {
    t = createTestDb();
    clock = new FakeClock(TEST_NOW);
    seedAdmin(t.db, TEST_NOW);
    session = seedSession(t.db, TEST_NOW);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    t.cleanup();
  });

  function mockLan(address: string | null) {
    vi.spyOn(os, "networkInterfaces").mockReturnValue(
      address
        ? {
            en0: [
              {
                address,
                netmask: "255.255.255.0",
                family: "IPv4",
                mac: "00:00:00:00:00:00",
                internal: false,
                cidr: `${address}/24`,
              },
            ],
          }
        : {},
    );
  }

  function buildApp() {
    const captured = captureLogger();
    const app = createAdminApp({ db: t.db, clock, logger: captured.logger }, { staticDir: null });
    return { app, lines: captured.lines };
  }

  function authHeaders(withCsrf = false): Record<string, string> {
    const headers: Record<string, string> = {
      Cookie: `${ADMIN_COOKIE}=${session.cookie}`,
    };
    if (withCsrf) {
      headers[CSRF_HEADER] = session.csrfToken;
    }
    return headers;
  }

  it("TC-NOUS54_DEV-12 GET /admin/api/invitations が issuedAt 降順の一覧と lanAddress（アドレスあり・null の両方）を 200 で返す", async () => {
    t.db
      .insert(invitations)
      .values([
        {
          invitation_id: "01JB00000000000000000INV01",
          label: "古い招待",
          token_hash: "1".repeat(64),
          issued_at: "2026-10-20T00:00:00.000Z",
          revoked_at: null,
          last_used_at: null,
        },
        {
          invitation_id: "01JB00000000000000000INV02",
          label: "新しい招待",
          token_hash: "2".repeat(64),
          issued_at: "2026-10-20T01:00:00.000Z",
          revoked_at: null,
          last_used_at: "2026-10-20T02:00:00.000Z",
        },
      ])
      .run();

    const { app } = buildApp();

    mockLan("192.168.1.10");
    const res1 = await app.request("/admin/api/invitations", { headers: authHeaders() });
    expect(res1.status).toBe(200);
    expect(await res1.json()).toEqual({
      items: [
        {
          invitationId: "01JB00000000000000000INV02",
          label: "新しい招待",
          issuedAt: "2026-10-20T01:00:00.000Z",
          revokedAt: null,
          lastUsedAt: "2026-10-20T02:00:00.000Z",
        },
        {
          invitationId: "01JB00000000000000000INV01",
          label: "古い招待",
          issuedAt: "2026-10-20T00:00:00.000Z",
          revokedAt: null,
          lastUsedAt: null,
        },
      ],
      lanAddress: "192.168.1.10",
    });

    mockLan(null);
    const res2 = await app.request("/admin/api/invitations", { headers: authHeaders() });
    expect(res2.status).toBe(200);
    expect(await res2.json()).toMatchObject({
      lanAddress: null,
    });
  });

  it("TC-NOUS54_DEV-13 POST /admin/api/invitations が 201 で invitationId と inviteUrl を返し、DB には sha256Hex のみ・監査ログにはトークン無しで記録し、ログにもトークンを出さない", async () => {
    mockLan("192.168.1.10");
    const { app, lines } = buildApp();

    const res = await app.request("/admin/api/invitations", {
      method: "POST",
      headers: { ...authHeaders(true), "Content-Type": "application/json" },
      body: JSON.stringify({ label: "  たなか  " }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { invitationId: string; inviteUrl: string };
    expect(body.invitationId).toHaveLength(26);
    expect(body.inviteUrl).toMatch(/^http:\/\/192\.168\.1\.10:\d+\/invite\/[A-Za-z0-9_-]{43}$/);

    const token = body.inviteUrl.split("/invite/")[1]!;
    const rows = t.db.select().from(invitations).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      invitation_id: body.invitationId,
      label: "たなか",
      token_hash: sha256Hex(token),
      issued_at: TEST_NOW.toISOString(),
      revoked_at: null,
      last_used_at: null,
    });
    expect(JSON.stringify(rows)).not.toContain(token);

    const audits = t.db.select().from(admin_audit_logs).all();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      operation: "invitation.issue",
      target_type: "invitation",
      target_id: body.invitationId,
      before_json: null,
      after_json: JSON.stringify({ invitationId: body.invitationId, label: "たなか" }),
    });
    expect(JSON.stringify(audits)).not.toContain(token);
    expect(JSON.stringify(audits)).not.toContain(sha256Hex(token));
    expect(JSON.stringify(lines())).not.toContain(token);
  });

  it("TC-NOUS54_DEV-14 POST /admin/api/invitations は label が空白のみまたは 31 字のとき 400 VALIDATION_ERROR を返す", async () => {
    mockLan("192.168.1.10");
    const { app } = buildApp();

    for (const label of ["   ", "あ".repeat(31)]) {
      const res = await app.request("/admin/api/invitations", {
        method: "POST",
        headers: { ...authHeaders(true), "Content-Type": "application/json" },
        body: JSON.stringify({ label }),
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        error: { code: "VALIDATION_ERROR" },
      });
    }
    expect(t.db.select().from(invitations).all()).toHaveLength(0);
  });

  it("TC-NOUS54_DEV-15 POST /admin/api/invitations は未失効の招待が 5 件あるとき 409 CONFLICT になり、1 件失効させれば再び 201 で発行できる", async () => {
    mockLan("192.168.1.10");
    const { app } = buildApp();

    const issuedIds: string[] = [];
    for (let i = 1; i <= 5; i += 1) {
      const res = await app.request("/admin/api/invitations", {
        method: "POST",
        headers: { ...authHeaders(true), "Content-Type": "application/json" },
        body: JSON.stringify({ label: `招待${i}` }),
      });
      expect(res.status).toBe(201);
      const data = (await res.json()) as { invitationId: string };
      issuedIds.push(data.invitationId);
    }

    const resOver = await app.request("/admin/api/invitations", {
      method: "POST",
      headers: { ...authHeaders(true), "Content-Type": "application/json" },
      body: JSON.stringify({ label: "6人目" }),
    });
    expect(resOver.status).toBe(409);
    expect(await resOver.json()).toEqual({
      error: {
        code: "CONFLICT",
        message: MAX_ACTIVE_INVITATIONS_MESSAGE,
        fields: {},
      },
    });

    const revokeRes = await app.request(`/admin/api/invitations/${issuedIds[0]}/revoke`, {
      method: "POST",
      headers: authHeaders(true),
    });
    expect(revokeRes.status).toBe(200);

    const resAfterRevoke = await app.request("/admin/api/invitations", {
      method: "POST",
      headers: { ...authHeaders(true), "Content-Type": "application/json" },
      body: JSON.stringify({ label: "6人目" }),
    });
    expect(resAfterRevoke.status).toBe(201);
  });

  it("TC-NOUS54_DEV-16 POST /admin/api/invitations は LAN アドレスが見つからないとき 409 LAN_ADDRESS_NOT_FOUND を返し、DB に行が増えない", async () => {
    mockLan(null);
    const { app } = buildApp();

    const res = await app.request("/admin/api/invitations", {
      method: "POST",
      headers: { ...authHeaders(true), "Content-Type": "application/json" },
      body: JSON.stringify({ label: "たなか" }),
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: { code: "LAN_ADDRESS_NOT_FOUND" },
    });
    expect(t.db.select().from(invitations).all()).toHaveLength(0);
    expect(t.db.select().from(admin_audit_logs).all()).toHaveLength(0);
  });

  it("TC-NOUS54_DEV-17 POST /admin/api/invitations/:invitationId/revoke が 200 で失効させ、監査ログに before: { revokedAt: null } と after: { revokedAt } を残す", async () => {
    mockLan("192.168.1.10");
    const { app } = buildApp();

    const issueRes = await app.request("/admin/api/invitations", {
      method: "POST",
      headers: { ...authHeaders(true), "Content-Type": "application/json" },
      body: JSON.stringify({ label: "たなか" }),
    });
    const { invitationId } = (await issueRes.json()) as { invitationId: string };

    await clock.advance(10_000);
    const revokeRes = await app.request(`/admin/api/invitations/${invitationId}/revoke`, {
      method: "POST",
      headers: authHeaders(true),
    });

    expect(revokeRes.status).toBe(200);
    expect(await revokeRes.json()).toEqual({
      invitationId,
      revokedAt: clock.nowIso(),
    });

    const audits = t.db.select().from(admin_audit_logs).all();
    const revokeAudit = audits.find((a) => a.operation === "invitation.revoke");
    expect(revokeAudit).toMatchObject({
      operation: "invitation.revoke",
      target_type: "invitation",
      target_id: invitationId,
      before_json: JSON.stringify({ revokedAt: null }),
      after_json: JSON.stringify({ revokedAt: clock.nowIso() }),
    });
  });

  it("TC-NOUS54_DEV-18 POST /admin/api/invitations/:invitationId/revoke は存在しない招待で 404 INVITATION_NOT_FOUND、失効済みで 409 ALREADY_REVOKED、26 字以外で 400 VALIDATION_ERROR を返す", async () => {
    mockLan("192.168.1.10");
    const { app } = buildApp();

    const invalidIdRes = await app.request("/admin/api/invitations/short/revoke", {
      method: "POST",
      headers: authHeaders(true),
    });
    expect(invalidIdRes.status).toBe(400);
    expect(await invalidIdRes.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });

    const notFoundRes = await app.request("/admin/api/invitations/01JB000000000000000UNKNOWN/revoke", {
      method: "POST",
      headers: authHeaders(true),
    });
    expect(notFoundRes.status).toBe(404);
    expect(await notFoundRes.json()).toMatchObject({ error: { code: "INVITATION_NOT_FOUND" } });

    const issueRes = await app.request("/admin/api/invitations", {
      method: "POST",
      headers: { ...authHeaders(true), "Content-Type": "application/json" },
      body: JSON.stringify({ label: "たなか" }),
    });
    const { invitationId } = (await issueRes.json()) as { invitationId: string };

    const firstRevoke = await app.request(`/admin/api/invitations/${invitationId}/revoke`, {
      method: "POST",
      headers: authHeaders(true),
    });
    expect(firstRevoke.status).toBe(200);

    const secondRevoke = await app.request(`/admin/api/invitations/${invitationId}/revoke`, {
      method: "POST",
      headers: authHeaders(true),
    });
    expect(secondRevoke.status).toBe(409);
    expect(await secondRevoke.json()).toMatchObject({ error: { code: "ALREADY_REVOKED" } });
  });
});
