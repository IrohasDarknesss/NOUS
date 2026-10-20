import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../../test/helpers/testDb";
import { TEST_NOW, seedAdmin, seedSession, testDeps } from "../../../test/helpers/adminTestSupport";
import { admin_sessions } from "../../db/schema";
import type { AdminEnv } from "../context";
import { errorHandler } from "./errorHandler";
import {
  ADMIN_COOKIE,
  SESSION_ABSOLUTE_MS,
  SESSION_IDLE_MS,
  deleteExpiredSessions,
  findActiveSession,
  requireAdminSession,
} from "./sessionAuth";

const HOUR = 60 * 60 * 1000;
const at = (ms: number) => new Date(TEST_NOW.getTime() + ms);

describe("sessionAuth", () => {
  let t: TestDb;
  beforeEach(() => {
    t = createTestDb();
    seedAdmin(t.db);
  });
  afterEach(() => t.cleanup());

  function app() {
    const deps = testDeps(t.db);
    const a = new Hono<AdminEnv>();
    a.onError(errorHandler);
    a.use("*", async (c, next) => {
      c.set("db", deps.db);
      c.set("clock", deps.clock);
      c.set("logger", deps.logger);
      await next();
    });
    a.use("*", requireAdminSession);
    a.get("/me", (c) => c.json(c.var.admin));
    return { a, clock: deps.clock };
  }

  it("TC-NOUS52_DEV-01 有効なセッションの Cookie で通り、c.var.admin に管理者が入る", async () => {
    const s = seedSession(t.db);
    const res = await app().a.request("/me", { headers: { Cookie: `${ADMIN_COOKIE}=${s.cookie}` } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ displayName: "Kaine Yamashiro", csrfToken: s.csrfToken });
  });

  it("TC-NOUS52_DEV-02 Cookie がない・知らない値なら 401 ADMIN_UNAUTHORIZED", async () => {
    const { a } = app();
    for (const headers of [{} as Record<string, string>, { Cookie: `${ADMIN_COOKIE}=unknown` }]) {
      const res = await a.request("/me", { headers });
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ error: { code: "ADMIN_UNAUTHORIZED" } });
    }
  });

  it("TC-NOUS52_DEV-03 最終操作を更新する", async () => {
    const s = seedSession(t.db);
    const { a, clock } = app();
    await clock.advance(30 * 60 * 1000);
    await a.request("/me", { headers: { Cookie: `${ADMIN_COOKIE}=${s.cookie}` } });
    const row = t.db.select().from(admin_sessions).where(eq(admin_sessions.session_hash, s.sessionHash)).get();
    expect(row?.last_seen_at).toBe(at(30 * 60 * 1000).toISOString());
  });

  it("TC-NOUS52_DEV-04 作成から 8 時間・最終操作から 60 分を過ぎたセッションは無効", () => {
    const s = seedSession(t.db);
    expect(findActiveSession(t.db, s.sessionHash, at(SESSION_IDLE_MS - 1))).toBeDefined();
    expect(findActiveSession(t.db, s.sessionHash, at(SESSION_IDLE_MS))).toBeUndefined();
    const old = seedSession(t.db, TEST_NOW, at(SESSION_ABSOLUTE_MS - 1000));
    expect(findActiveSession(t.db, old.sessionHash, at(SESSION_ABSOLUTE_MS - 1))).toBeDefined();
    expect(findActiveSession(t.db, old.sessionHash, at(SESSION_ABSOLUTE_MS))).toBeUndefined();
  });

  it("TC-NOUS52_DEV-05 deleteExpiredSessions が失効したものだけを消す", async () => {
    const live = seedSession(t.db, at(2 * HOUR), at(2 * HOUR));
    seedSession(t.db); // 最終操作から 60 分を過ぎる
    seedSession(t.db, at(-8 * HOUR), at(2 * HOUR)); // 作成から 8 時間を過ぎる
    const { clock } = app();
    await clock.advanceTo(at(2 * HOUR + 1000));
    expect(deleteExpiredSessions(t.db, clock)).toBe(2);
    const rest = t.db.select().from(admin_sessions).all();
    expect(rest.map((r) => r.session_hash)).toEqual([live.sessionHash]);
  });
});
