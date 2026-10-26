// 単体テスト（NOUS-91）。観点表は docs/test/unit/NOUS-91/観点表_admin_common.json
import { once } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../test/helpers/testDb";
import { TEST_NOW, captureLogger, seedAdmin, seedSession, testDeps } from "../../test/helpers/adminTestSupport";
import { closeDb } from "../db/client";
import { admin_sessions } from "../db/schema";
import { AdminBindError, assertLocalBind, createAdminApp, startAdminServer, type AdminServer } from "./adminServer";
import { ADMIN_COOKIE } from "./middleware/sessionAuth";

const HOUR = 60 * 60 * 1000;

/** listen が終わるのを待つ（終わる前に close すると "Server is not running" になる） */
async function listening(started: AdminServer): Promise<void> {
  if (!started.server.listening) await once(started.server, "listening");
}

describe("adminServer（単体テスト）", () => {
  let t: TestDb;
  let captured: ReturnType<typeof captureLogger>;

  beforeEach(() => {
    t = createTestDb();
    seedAdmin(t.db);
    captured = captureLogger();
  });

  afterEach(() => t.cleanup());

  it.each(["localhost", "0.0.0.0", "::1", "127.0.0.2", ""])(
    "TC-UT_ADM-001 assertLocalBind は 127.0.0.1 以外を AdminBindError にし、指定のアドレスを文言に入れる（%j）",
    (host) => {
      expect(() => assertLocalBind(host)).toThrow(AdminBindError);
      expect(() => assertLocalBind(host)).toThrow(`（指定: ${host}）`);
    },
  );

  it("TC-UT_ADM-002 127.0.0.1 以外を渡すと、期限切れのセッションの削除も定期の削除も始めずに止まる", () => {
    seedSession(t.db, new Date(TEST_NOW.getTime() - 2 * HOUR));
    const deps = testDeps(t.db);

    expect(() => startAdminServer(deps, 0, { host: "0.0.0.0", staticDir: null })).toThrow(AdminBindError);

    expect(t.db.select().from(admin_sessions).all()).toHaveLength(1);
    expect(deps.clock.pendingCount()).toBe(0);
  });

  it.each([
    ["POST", "/admin/api/session"],
    ["GET", "/admin/api/login"],
    ["DELETE", "/admin/api/session"],
  ])("TC-UT_ADM-003 公開の道とメソッドが違えばセッションを求める（%s %s）", async (method, path) => {
    const a = createAdminApp(testDeps(t.db), { staticDir: null });

    const res = await a.request(path, { method });

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "ADMIN_UNAUTHORIZED" } });
  });

  it("TC-UT_ADM-004 HEAD /admin/api/session は CSRF を求めず、有効なセッションなら 200 を返す", async () => {
    const s = seedSession(t.db);
    const a = createAdminApp(testDeps(t.db), { staticDir: null });

    const res = await a.request("/admin/api/session", {
      method: "HEAD",
      headers: { Cookie: `${ADMIN_COOKIE}=${s.cookie}` },
    });

    expect(res.status).toBe(200);
  });

  describe("画面の静的ファイル", () => {
    let dir: string;

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), "nous-admin-dist-ut-"));
      writeFileSync(join(dir, "index.html"), "<html>admin</html>");
    });

    afterEach(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    it("TC-UT_ADM-005 ログイン中でも、/admin/api 以下の知らない道には index.html を返さない", async () => {
      const s = seedSession(t.db);
      const a = createAdminApp(testDeps(t.db), { staticDir: dir });

      const res = await a.request("/admin/api/unknown", { headers: { Cookie: `${ADMIN_COOKIE}=${s.cookie}` } });

      expect(res.status).toBe(404);
      expect(await res.text()).not.toContain("<html>admin</html>");
    });

    it("TC-UT_ADM-006 静的ファイルの置き場所が無ければ画面を配らない", async () => {
      const a = createAdminApp(testDeps(t.db), { staticDir: join(dir, "missing") });

      const res = await a.request("/agents");

      expect(res.status).toBe(404);
    });
  });

  it("TC-UT_ADM-007 起動時の削除が 0 件ならログを出さず、1 件以上なら件数をログに出す", async () => {
    const deps = { ...testDeps(t.db), logger: captured.logger };
    const started = startAdminServer(deps, 0, { staticDir: null });
    try {
      await listening(started);
      expect(captured.lines().filter((l) => l.msg === "admin_sessions_swept")).toHaveLength(0);

      seedSession(t.db);
      await deps.clock.advance(2 * HOUR);

      expect(captured.lines().filter((l) => l.msg === "admin_sessions_swept")).toEqual([
        expect.objectContaining({ level: "info", deleted: 1 }),
      ]);
    } finally {
      await started.close();
    }
  });

  it("TC-UT_ADM-008 期限切れのセッションの削除に失敗しても、error のログを出して起動を続ける", async () => {
    const deps = { ...testDeps(t.db), logger: captured.logger };
    closeDb(t.db);

    const started = startAdminServer(deps, 0, { staticDir: null });
    try {
      expect(captured.lines()).toContainEqual(
        expect.objectContaining({ level: "error", msg: "admin_sessions_sweep_failed" }),
      );
      expect(deps.clock.pendingCount()).toBe(1);
      await listening(started);
    } finally {
      await started.close();
    }
  });
});
