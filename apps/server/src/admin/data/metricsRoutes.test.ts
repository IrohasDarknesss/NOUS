import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TEST_NOW, seedAdmin, seedSession, testDeps } from "../../../test/helpers/adminTestSupport";
import { createTestDb, type TestDb } from "../../../test/helpers/testDb";
import { FakeClock } from "../../clock/fakeClock";
import { daily_metrics, daily_usage, world_settings, worlds } from "../../db/schema";
import { newUlid } from "../../lib/ids";
import { createAdminApp } from "../adminServer";
import { ADMIN_COOKIE } from "../middleware/sessionAuth";

describe("metricsRoutes (/admin/api/metrics/daily)", () => {
  let t: TestDb;
  let clock: FakeClock;
  let cookie: string;

  beforeEach(() => {
    t = createTestDb();
    clock = new FakeClock(TEST_NOW);
    seedAdmin(t.db, TEST_NOW);
    const s = seedSession(t.db, TEST_NOW);
    cookie = `${ADMIN_COOKIE}=${s.cookie}`;
  });

  afterEach(() => {
    t.cleanup();
  });

  function app() {
    return createAdminApp(testDeps(t.db, clock), { staticDir: null });
  }

  function authHeaders(): Record<string, string> {
    return { Cookie: cookie };
  }

  function seedRunningWorld(neuronsLimit = 9500): string {
    const worldId = newUlid(clock.nowMs());
    const iso = clock.nowIso();
    t.db
      .insert(worlds)
      .values({
        world_id: worldId,
        name: "世界 2026-10-20",
        state: "running",
        running_since: iso,
        created_at: iso,
        started_at: iso,
      })
      .run();

    t.db
      .insert(world_settings)
      .values({
        world_id: worldId,
        daily_neurons_limit: neuronsLimit,
        updated_at: iso,
      })
      .run();

    return worldId;
  }

  it("TC-NOUS65_DEV-28 GET /admin/api/metrics/daily はパラメータ省略時に直近14日分の指標を 200 で返す", async () => {
    seedRunningWorld(8800);
    const a = app();
    const res = await a.request("/admin/api/metrics/daily", { headers: authHeaders() });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { freeTierNeurons: number; neuronsLimit: number; items: Array<{ usageDate: string }> };
    expect(body.freeTierNeurons).toBe(10000);
    expect(body.neuronsLimit).toBe(8800);
    expect(body.items).toHaveLength(14);
    expect(body.items[0]?.usageDate).toBe("2026-10-07");
    expect(body.items[13]?.usageDate).toBe("2026-10-20");
  });

  it("TC-NOUS65_DEV-29 GET /admin/api/metrics/daily は指定期間の指標を 200 で返し、分母 0 の null とデータなし日の 0 を含む", async () => {
    const worldId = seedRunningWorld();

    t.db
      .insert(daily_usage)
      .values({
        usage_date: "2026-10-02",
        calls: 10,
        runs: 5,
        prompt_tokens: 100,
        completion_tokens: 50,
        neurons: 12.5,
      })
      .run();

    t.db
      .insert(daily_metrics)
      .values({
        world_id: worldId,
        usage_date: "2026-10-02",
        runs: 5,
        posts: 2,
        replies: 3,
        replied_posts: 1,
        likes: 4,
        follows: 1,
        nones: 0,
        failures: 1,
      })
      .run();

    const a = app();
    const res = await a.request("/admin/api/metrics/daily?from=2026-10-01&to=2026-10-02", { headers: authHeaders() });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: Array<{
        usageDate: string;
        replyRate: number | null;
        errorRate: number | null;
        actions: number;
        costJpy: number;
        calls: number;
      }>;
    };
    expect(body.items).toHaveLength(2);

    // 2026-10-01: データなし（すべて 0、分母 0 の率は null）
    expect(body.items[0]).toEqual({
      usageDate: "2026-10-01",
      calls: 0,
      runs: 0,
      promptTokens: 0,
      completionTokens: 0,
      neurons: 0,
      costJpy: 0,
      posts: 0,
      replies: 0,
      replyRate: null,
      likes: 0,
      follows: 0,
      nones: 0,
      actions: 0,
      failures: 0,
      errorRate: null,
    });

    // 2026-10-02: 計算値が反映
    expect(body.items[1]).toMatchObject({
      usageDate: "2026-10-02",
      calls: 10,
      runs: 5,
      replyRate: 1 / 2, // 0.5
      errorRate: 1 / 5, // 0.2
      actions: 2 + 3 + 4 + 1, // 10
      costJpy: 0,
    });
  });

  it("TC-NOUS65_DEV-30 GET /admin/api/metrics/daily は開始が終了より後、90日を超える期間、不正な日付に 400 VALIDATION_ERROR を返す", async () => {
    seedRunningWorld();
    const a = app();

    // 開始が終了より後
    const r1 = await a.request("/admin/api/metrics/daily?from=2026-10-10&to=2026-10-01", { headers: authHeaders() });
    expect(r1.status).toBe(400);
    expect(await r1.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });

    // 90日を超える（91日間）
    const r2 = await a.request("/admin/api/metrics/daily?from=2026-01-01&to=2026-04-02", { headers: authHeaders() });
    expect(r2.status).toBe(400);
    expect(await r2.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });

    // 不正な日付形式
    const r3 = await a.request("/admin/api/metrics/daily?from=2026-13-01&to=2026-13-05", { headers: authHeaders() });
    expect(r3.status).toBe(400);
    expect(await r3.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
  });
});
