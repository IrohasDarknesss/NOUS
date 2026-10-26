// 単体テスト（NOUS-91）。観点表は docs/test/unit/NOUS-91/観点表_admin_common.json
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../../test/helpers/testDb";
import { TEST_NOW, seedAdmin, seedSession, testDeps } from "../../../test/helpers/adminTestSupport";
import { FakeClock } from "../../clock/fakeClock";
import { admin_sessions } from "../../db/schema";
import type { AdminEnv } from "../context";
import { errorHandler } from "./errorHandler";
import {
  ADMIN_COOKIE,
  SESSION_ABSOLUTE_MS,
  SESSION_IDLE_MS,
  deleteExpiredSessions,
  requireAdminSession,
} from "./sessionAuth";

const at = (ms: number) => new Date(TEST_NOW.getTime() + ms);

describe("sessionAuth（単体テスト）", () => {
  let t: TestDb;

  beforeEach(() => {
    t = createTestDb();
    seedAdmin(t.db);
  });

  afterEach(() => t.cleanup());

  function app(clock = new FakeClock(TEST_NOW)) {
    const deps = testDeps(t.db, clock);
    const a = new Hono<AdminEnv>();
    a.onError(errorHandler);
    a.use("*", async (c, next) => {
      c.set("db", deps.db);
      c.set("clock", deps.clock);
      c.set("logger", deps.logger);
      await next();
    });
    a.use("*", requireAdminSession);
    a.get("/me", (c) => c.json({ adminId: c.var.admin.adminId }));
    return a;
  }

  const lastSeen = (sessionHash: string) =>
    t.db.select().from(admin_sessions).where(eq(admin_sessions.session_hash, sessionHash)).get()?.last_seen_at;

  it("TC-UT_ADM-019 値が空の Cookie は Cookie がないものとして 401 にする", async () => {
    const res = await app().request("/me", { headers: { Cookie: `${ADMIN_COOKIE}=` } });

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "ADMIN_UNAUTHORIZED" } });
  });

  it("TC-UT_ADM-020 DB の session_hash をそのまま Cookie に入れても通らない（Cookie の値をハッシュして探す）", async () => {
    const s = seedSession(t.db);

    const res = await app().request("/me", { headers: { Cookie: `${ADMIN_COOKIE}=${s.sessionHash}` } });

    expect(res.status).toBe(401);
  });

  it("TC-UT_ADM-021 最終操作からちょうど 60 分のセッションは 401 にし、最終操作の時刻を更新しない", async () => {
    const s = seedSession(t.db);
    const clock = new FakeClock(at(SESSION_IDLE_MS));

    const res = await app(clock).request("/me", { headers: { Cookie: `${ADMIN_COOKIE}=${s.cookie}` } });

    expect(res.status).toBe(401);
    expect(lastSeen(s.sessionHash)).toBe(TEST_NOW.toISOString());
  });

  it("TC-UT_ADM-022 deleteExpiredSessions は作成から 8 時間ちょうど・最終操作から 60 分ちょうどのものを消し、1 ms 手前のものは残す", () => {
    const now = at(SESSION_ABSOLUTE_MS);
    const absoluteJust = seedSession(t.db, at(0), at(SESSION_ABSOLUTE_MS - 1000));
    const absoluteBefore = seedSession(t.db, at(1), at(SESSION_ABSOLUTE_MS - 1000));
    const idleJust = seedSession(
      t.db,
      at(SESSION_ABSOLUTE_MS - 2 * SESSION_IDLE_MS),
      at(SESSION_ABSOLUTE_MS - SESSION_IDLE_MS),
    );
    const idleBefore = seedSession(
      t.db,
      at(SESSION_ABSOLUTE_MS - 2 * SESSION_IDLE_MS),
      at(SESSION_ABSOLUTE_MS - SESSION_IDLE_MS + 1),
    );

    const deleted = deleteExpiredSessions(t.db, new FakeClock(now));

    expect(deleted).toBe(2);
    const rest = t.db
      .select()
      .from(admin_sessions)
      .all()
      .map((r) => r.session_hash)
      .sort();
    expect(rest).toEqual([absoluteBefore.sessionHash, idleBefore.sessionHash].sort());
    expect(rest).not.toContain(absoluteJust.sessionHash);
    expect(rest).not.toContain(idleJust.sessionHash);
  });
});
