import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TEST_ADMIN_ID, TEST_NOW, seedSession, testDeps } from "../../../test/helpers/adminTestSupport";
import { createTestDb, type TestDb } from "../../../test/helpers/testDb";
import { admin_account, admin_audit_logs, admin_sessions } from "../../db/schema";
import { createAdminApp } from "../adminServer";
import { CSRF_HEADER } from "../middleware/csrf";
import { ADMIN_COOKIE } from "../middleware/sessionAuth";
import { hashPassword } from "./passwordHasher";

const PASSWORD = "correct-password-123";

describe("authRoutes", () => {
  let t: TestDb;

  beforeEach(() => {
    t = createTestDb();
  });

  afterEach(() => t.cleanup());

  async function seedAdminWithPassword(password = PASSWORD): Promise<void> {
    const passwordHash = await hashPassword(password);
    t.db
      .insert(admin_account)
      .values({
        admin_id: TEST_ADMIN_ID,
        display_name: "Kaine Yamashiro",
        password_hash: passwordHash,
        failed_count: 0,
        locked_until: null,
        updated_at: TEST_NOW.toISOString(),
      })
      .run();
  }

  function buildApp() {
    const deps = testDeps(t.db);
    const app = createAdminApp(deps, { staticDir: null });
    return { app, clock: deps.clock };
  }

  it("TC-NOUS53_DEV-11 POST /admin/api/login が成功で Set-Cookie と { displayName, csrfToken } を 200 で返し、監査を残す", async () => {
    await seedAdminWithPassword();
    const { app } = buildApp();

    const res = await app.request("/admin/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: PASSWORD }),
    });

    expect(res.status).toBe(200);
    const setCookie = res.headers.get("Set-Cookie");
    expect(setCookie).toMatch(/^aisns_admin=[A-Za-z0-9_-]{43}; HttpOnly; SameSite=Strict; Path=\/$/);
    expect(setCookie).not.toContain("Secure");

    const body = (await res.json()) as { displayName: string; csrfToken: string };
    expect(body.displayName).toBe("Kaine Yamashiro");
    expect(body.csrfToken).toHaveLength(43);

    const audits = t.db.select().from(admin_audit_logs).all();
    expect(audits).toHaveLength(1);
    expect(audits[0]?.operation).toBe("admin.login");
  });

  it("TC-NOUS53_DEV-12 POST /admin/api/login は password が 12 字未満・129 字以上なら 400 VALIDATION_ERROR", async () => {
    await seedAdminWithPassword();
    const { app } = buildApp();

    for (const password of ["short", "12345678901", "a".repeat(129)]) {
      const res = await app.request("/admin/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        error: { code: "VALIDATION_ERROR" },
      });
    }
  });

  it("TC-NOUS53_DEV-13 POST /admin/api/login はパスワード未設定なら 409 ADMIN_NOT_SET、不一致なら 401、ロック中なら 429", async () => {
    const { app } = buildApp();

    const notSetRes = await app.request("/admin/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: PASSWORD }),
    });
    expect(notSetRes.status).toBe(409);
    expect(await notSetRes.json()).toMatchObject({ error: { code: "ADMIN_NOT_SET" } });

    await seedAdminWithPassword();
    for (let i = 1; i <= 5; i += 1) {
      const failRes = await app.request("/admin/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "wrong-password-123" }),
      });
      expect(failRes.status).toBe(401);
      expect(await failRes.json()).toMatchObject({ error: { code: "LOGIN_FAILED" } });
    }

    const lockedRes = await app.request("/admin/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: PASSWORD }),
    });
    expect(lockedRes.status).toBe(429);
    expect(await lockedRes.json()).toMatchObject({
      error: {
        code: "LOGIN_LOCKED",
        message: "ログインの試行が続いたため、09:15 まで受け付けません",
        fields: { lockedUntil: "2026-10-20T00:15:00.000Z" },
      },
    });
  });

  it("TC-NOUS53_DEV-14 POST /admin/api/logout が 204 と Cookie 削除ヘッダーを返し、セッション行を削除して監査を残す", async () => {
    await seedAdminWithPassword();
    const s = seedSession(t.db);
    const { app } = buildApp();

    const res = await app.request("/admin/api/logout", {
      method: "POST",
      headers: {
        Cookie: `${ADMIN_COOKIE}=${s.cookie}`,
        [CSRF_HEADER]: s.csrfToken,
      },
    });

    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    expect(res.headers.get("Set-Cookie")).toBe("aisns_admin=; Max-Age=0; Path=/");
    expect(t.db.select().from(admin_sessions).all()).toHaveLength(0);

    const audits = t.db.select().from(admin_audit_logs).all();
    expect(audits).toHaveLength(1);
    expect(audits[0]?.operation).toBe("admin.logout");
  });

  it("TC-NOUS53_DEV-15 POST /admin/api/logout は CSRF トークンがなければ 403 CSRF_INVALID、セッションがなければ 401", async () => {
    await seedAdminWithPassword();
    const s = seedSession(t.db);
    const { app } = buildApp();

    const noCsrf = await app.request("/admin/api/logout", {
      method: "POST",
      headers: { Cookie: `${ADMIN_COOKIE}=${s.cookie}` },
    });
    expect(noCsrf.status).toBe(403);
    expect(await noCsrf.json()).toMatchObject({ error: { code: "CSRF_INVALID" } });
    expect(t.db.select().from(admin_sessions).all()).toHaveLength(1);

    const noCookie = await app.request("/admin/api/logout", { method: "POST" });
    expect(noCookie.status).toBe(401);
    expect(await noCookie.json()).toMatchObject({ error: { code: "ADMIN_UNAUTHORIZED" } });
  });

  it("TC-NOUS53_DEV-16 GET /admin/api/session は有効なセッションで 200 と { displayName, csrfToken, expiresAt } を返し、last_seen_at を更新する", async () => {
    await seedAdminWithPassword();
    const s = seedSession(t.db);
    const { app, clock } = buildApp();

    await clock.advance(10 * 60 * 1000);
    const res = await app.request("/admin/api/session", {
      headers: { Cookie: `${ADMIN_COOKIE}=${s.cookie}` },
    });

    expect(res.status).toBe(200);
    const expectedNow = new Date(TEST_NOW.getTime() + 10 * 60 * 1000);
    const expectedExpires = new Date(expectedNow.getTime() + 60 * 60 * 1000).toISOString();
    expect(await res.json()).toEqual({
      displayName: "Kaine Yamashiro",
      csrfToken: s.csrfToken,
      expiresAt: expectedExpires,
    });

    const row = t.db.select().from(admin_sessions).get();
    expect(row?.last_seen_at).toBe(expectedNow.toISOString());
  });

  it("TC-NOUS53_DEV-17 GET /admin/api/session はパスワード未設定なら Cookie なしでも 409 ADMIN_NOT_SET、設定済みで Cookie なしなら 401 ADMIN_UNAUTHORIZED", async () => {
    const { app } = buildApp();

    const notSetRes = await app.request("/admin/api/session");
    expect(notSetRes.status).toBe(409);
    expect(await notSetRes.json()).toMatchObject({ error: { code: "ADMIN_NOT_SET" } });

    await seedAdminWithPassword();
    const unauthRes = await app.request("/admin/api/session");
    expect(unauthRes.status).toBe(401);
    expect(await unauthRes.json()).toMatchObject({ error: { code: "ADMIN_UNAUTHORIZED" } });
  });
});
