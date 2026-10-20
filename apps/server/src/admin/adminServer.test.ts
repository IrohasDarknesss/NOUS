import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../test/helpers/testDb";
import { TEST_NOW, seedAdmin, seedSession, testDeps } from "../../test/helpers/adminTestSupport";
import { admin_sessions } from "../db/schema";
import { AdminBindError, assertLocalBind, createAdminApp, startAdminServer } from "./adminServer";
import { CSRF_HEADER } from "./middleware/csrf";
import { ADMIN_COOKIE } from "./middleware/sessionAuth";

describe("adminServer", () => {
  let t: TestDb;
  beforeEach(() => {
    t = createTestDb();
    seedAdmin(t.db);
  });
  afterEach(() => t.cleanup());

  function app() {
    const a = createAdminApp(testDeps(t.db), { staticDir: null });
    a.get("/admin/api/__probe", (c) => c.json({ adminId: c.var.admin.adminId }));
    a.post("/admin/api/__probe", (c) => c.json({ ok: true }));
    a.post("/admin/api/login", (c) => c.json({ public: true }));
    a.get("/admin/api/session", (c) => c.json({ public: true }));
    return a;
  }

  it("TC-NOUS52_DEV-17 127.0.0.1 以外のアドレスでは起動しない", () => {
    expect(() => assertLocalBind("127.0.0.1")).not.toThrow();
    for (const host of ["0.0.0.0", "::", "localhost", "192.168.1.10"]) {
      expect(() => assertLocalBind(host)).toThrow(AdminBindError);
    }
    expect(() => startAdminServer(testDeps(t.db), 0, { host: "0.0.0.0", staticDir: null })).toThrow(AdminBindError);
  });

  it("TC-NOUS52_DEV-18 /admin/api 以下はセッションがなければ 401", async () => {
    const res = await app().request("/admin/api/__probe");
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "ADMIN_UNAUTHORIZED" } });
  });

  it("TC-NOUS52_DEV-19 変更の要求はセッションに加えて CSRF を確かめる", async () => {
    const s = seedSession(t.db);
    const cookie = `${ADMIN_COOKIE}=${s.cookie}`;
    const a = app();
    expect((await a.request("/admin/api/__probe", { headers: { Cookie: cookie } })).status).toBe(200);
    expect((await a.request("/admin/api/__probe", { method: "POST", headers: { Cookie: cookie } })).status).toBe(403);
    const ok = await a.request("/admin/api/__probe", {
      method: "POST",
      headers: { Cookie: cookie, [CSRF_HEADER]: s.csrfToken },
    });
    expect(ok.status).toBe(200);
  });

  it("TC-NOUS52_DEV-20 login と GET /session は requireAdminSession・requireCsrf を通さない", async () => {
    const a = app();
    expect((await a.request("/admin/api/login", { method: "POST" })).status).toBe(200);
    expect((await a.request("/admin/api/session")).status).toBe(200);
  });

  it("TC-NOUS52_DEV-21 起動時に期限切れのセッションを消し、60 分ごとに消し直す", async () => {
    seedSession(t.db, new Date(TEST_NOW.getTime() - 2 * 60 * 60 * 1000));
    const deps = testDeps(t.db);
    const started = startAdminServer(deps, 0, { staticDir: null });
    try {
      expect(t.db.select().from(admin_sessions).all()).toHaveLength(0);
      seedSession(t.db);
      await deps.clock.advance(2 * 60 * 60 * 1000);
      expect(t.db.select().from(admin_sessions).all()).toHaveLength(0);
    } finally {
      await started.close();
    }
  });

  it("TC-NOUS52_DEV-22 画面の静的ファイルを配り、画面の URL では index.html を返す", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nous-admin-dist-"));
    try {
      writeFileSync(join(dir, "index.html"), "<html>admin</html>");
      writeFileSync(join(dir, "app.js"), "console.log(1)");
      const a = createAdminApp(testDeps(t.db), { staticDir: dir });
      expect(await (await a.request("/")).text()).toContain("admin");
      expect(await (await a.request("/app.js")).text()).toContain("console.log");
      expect(await (await a.request("/agents")).text()).toContain("admin");
      expect((await a.request("/admin/api/unknown")).status).toBe(401);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
