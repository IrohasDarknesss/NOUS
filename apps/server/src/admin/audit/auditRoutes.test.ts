import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TEST_ADMIN_ID, TEST_NOW, seedAdmin, seedSession, testDeps } from "../../../test/helpers/adminTestSupport";
import { createTestDb, type TestDb } from "../../../test/helpers/testDb";
import { admin_audit_logs } from "../../db/schema";
import { createAdminApp } from "../adminServer";
import { ADMIN_COOKIE } from "../middleware/sessionAuth";
import { type ListAuditLogsResult } from "./auditRoutes";

describe("auditRoutes", () => {
  let t: TestDb;
  let session: { cookie: string; csrfToken: string; sessionHash: string };

  beforeEach(() => {
    t = createTestDb();
    seedAdmin(t.db, TEST_NOW);
    session = seedSession(t.db, TEST_NOW);
  });

  afterEach(() => {
    t.cleanup();
  });

  function app() {
    return createAdminApp(testDeps(t.db), { staticDir: null });
  }

  function authHeaders(): Record<string, string> {
    return { Cookie: `${ADMIN_COOKIE}=${session.cookie}` };
  }

  function seedLogs() {
    t.db
      .insert(admin_audit_logs)
      .values([
        {
          audit_id: "01JB00000000000000000AUD01",
          admin_id: TEST_ADMIN_ID,
          operation: "admin.login",
          target_type: "admin",
          target_id: TEST_ADMIN_ID,
          before_json: null,
          after_json: null,
          world_id: null,
          operated_at: "2026-10-20T01:00:00.000Z",
        },
        {
          audit_id: "01JB00000000000000000AUD02",
          admin_id: TEST_ADMIN_ID,
          operation: "invitation.issue",
          target_type: "invitation",
          target_id: "01JB00000000000000000INV01",
          before_json: null,
          after_json: JSON.stringify({ invitationId: "01JB00000000000000000INV01", label: "たなか" }),
          world_id: null,
          operated_at: "2026-10-20T02:00:00.000Z",
        },
        {
          audit_id: "01JB00000000000000000AUD03",
          admin_id: TEST_ADMIN_ID,
          operation: "invitation.revoke",
          target_type: "invitation",
          target_id: "01JB00000000000000000INV01",
          before_json: JSON.stringify({ revokedAt: null }),
          after_json: JSON.stringify({ revokedAt: "2026-10-20T02:00:00.000Z" }),
          world_id: null,
          operated_at: "2026-10-20T02:00:00.000Z",
        },
        {
          audit_id: "01JB00000000000000000AUD04",
          admin_id: TEST_ADMIN_ID,
          operation: "settings.update",
          target_type: "settings",
          target_id: null,
          before_json: JSON.stringify({ cycleMinutes: 20 }),
          after_json: JSON.stringify({ cycleMinutes: 30 }),
          world_id: null,
          operated_at: "2026-10-20T03:00:00.000Z",
        },
      ])
      .run();
  }

  it("TC-NOUS54_DEV-19 GET /admin/api/audit-logs が (operated_at DESC, audit_id DESC) の順で返し、beforeJson・afterJson をパース済み JSON（NULL は null）で返す", async () => {
    seedLogs();
    const res = await app().request("/admin/api/audit-logs", { headers: authHeaders() });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ListAuditLogsResult;

    expect(body.nextCursor).toBeNull();
    expect(body.items.map((i) => i.auditId)).toEqual([
      "01JB00000000000000000AUD04",
      "01JB00000000000000000AUD03",
      "01JB00000000000000000AUD02",
      "01JB00000000000000000AUD01",
    ]);
    expect(body.items[0]).toEqual({
      auditId: "01JB00000000000000000AUD04",
      operation: "settings.update",
      targetType: "settings",
      targetId: null,
      beforeJson: { cycleMinutes: 20 },
      afterJson: { cycleMinutes: 30 },
      operatedAt: "2026-10-20T03:00:00.000Z",
    });
    expect(body.items[3]?.beforeJson).toBeNull();
    expect(body.items[3]?.afterJson).toBeNull();
  });

  it("TC-NOUS54_DEV-20 GET /admin/api/audit-logs の operation 指定で該当する操作履歴のみに絞り込める", async () => {
    seedLogs();
    const res = await app().request("/admin/api/audit-logs?operation=invitation.revoke", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ListAuditLogsResult;
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.auditId).toBe("01JB00000000000000000AUD03");
    expect(body.items[0]?.beforeJson).toEqual({ revokedAt: null });
  });

  it("TC-NOUS54_DEV-21 GET /admin/api/audit-logs の limit と nextCursor で同一 operated_at を含む履歴を重複・欠落なくページング取得でき、最終ページは nextCursor: null になる", async () => {
    seedLogs();
    const a = app();

    const page1Res = await a.request("/admin/api/audit-logs?limit=2", { headers: authHeaders() });
    expect(page1Res.status).toBe(200);
    const page1 = (await page1Res.json()) as ListAuditLogsResult;
    expect(page1.items.map((i) => i.auditId)).toEqual(["01JB00000000000000000AUD04", "01JB00000000000000000AUD03"]);
    expect(page1.nextCursor).toEqual(expect.any(String));

    const page2Res = await a.request(`/admin/api/audit-logs?limit=2&cursor=${encodeURIComponent(page1.nextCursor!)}`, {
      headers: authHeaders(),
    });
    expect(page2Res.status).toBe(200);
    const page2 = (await page2Res.json()) as ListAuditLogsResult;
    expect(page2.items.map((i) => i.auditId)).toEqual(["01JB00000000000000000AUD02", "01JB00000000000000000AUD01"]);
    expect(page2.nextCursor).toBeNull();
  });

  it("TC-NOUS54_DEV-22 GET /admin/api/audit-logs は不正な operation のとき 400 VALIDATION_ERROR を返す", async () => {
    const res = await app().request("/admin/api/audit-logs?operation=unknown.op", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR" },
    });
  });

  it("TC-NOUS54_DEV-23 GET /admin/api/audit-logs は不正な limit（0・101・非整数）のとき 400 VALIDATION_ERROR を返す", async () => {
    const a = app();
    for (const badLimit of ["0", "101", "-1", "abc", "1.5", ""]) {
      const res = await a.request(`/admin/api/audit-logs?limit=${encodeURIComponent(badLimit)}`, {
        headers: authHeaders(),
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        error: { code: "VALIDATION_ERROR" },
      });
    }
  });

  it("TC-NOUS54_DEV-24 GET /admin/api/audit-logs は不正な cursor（非 Base64URL・非 JSON・配列でない・文字列 2 要素でない）のとき 400 VALIDATION_ERROR を返す", async () => {
    const a = app();
    const toBase64Url = (s: string) => Buffer.from(s, "utf8").toString("base64url");
    const badCursors = [
      "",
      "not+base64/url=",
      toBase64Url("not-json{"),
      toBase64Url(JSON.stringify({ a: "1" })),
      toBase64Url(JSON.stringify(["only-one"])),
      toBase64Url(JSON.stringify(["one", "two", "three"])),
      toBase64Url(JSON.stringify([123, 456])),
    ];

    for (const badCursor of badCursors) {
      const res = await a.request(`/admin/api/audit-logs?cursor=${encodeURIComponent(badCursor)}`, {
        headers: authHeaders(),
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        error: {
          code: "VALIDATION_ERROR",
          fields: { cursor: "カーソルが正しくありません" },
        },
      });
    }
  });
});
