// 単体テスト（NOUS-97）。観点表は docs/test/unit/NOUS-97/観点表_settings.json
import { FREE_TIER_NEURONS } from "@nous/shared";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureLogger, seedAdmin, seedSession } from "../../test/helpers/adminTestSupport";
import { createTestDb, type TestDb } from "../../test/helpers/testDb";
import { createAdminApp } from "../admin/adminServer";
import { CSRF_HEADER } from "../admin/middleware/csrf";
import { ADMIN_COOKIE } from "../admin/middleware/sessionAuth";
import { FakeClock } from "../clock/fakeClock";
import { admin_audit_logs, agents, world_settings, worlds } from "../db/schema";
import { withTx } from "../db/tx";
import { newUlid } from "../lib/ids";
import { configureWorldApi, resetWorldApi } from "./worldRoutes";
import { createInitialWorld, findCurrentWorld, type SchedulerControl, type WorldRow } from "./worldService";

const START = new Date("2026-10-22T00:00:00.000Z");

let t: TestDb;
let clock: FakeClock;
let session: { cookie: string; csrfToken: string; sessionHash: string };
let scheduler: SchedulerControl & { stopAll: ReturnType<typeof vi.fn>; wake: ReturnType<typeof vi.fn> };

function app() {
  return createAdminApp({ db: t.db, clock, logger: captureLogger().logger }, { staticDir: null });
}

function headers(opts: { csrf?: boolean; json?: boolean } = {}): Record<string, string> {
  const h: Record<string, string> = { Cookie: `${ADMIN_COOKIE}=${session.cookie}` };
  if (opts.csrf ?? true) h[CSRF_HEADER] = session.csrfToken;
  if (opts.json) h["Content-Type"] = "application/json";
  return h;
}

function seedWorld(): WorldRow {
  return withTx(t.db, (tx) => createInitialWorld(tx, clock.now()));
}

function addAgent(worldId: string): void {
  const iso = clock.nowIso();
  t.db
    .insert(agents)
    .values({
      agent_id: newUlid(),
      world_id: worldId,
      handle: "alice",
      display_name: "alice",
      interests: "星",
      topics: "宇宙",
      personality: "穏やか",
      values_text: "誠実",
      stance: "中立",
      state: "active",
      created_at: iso,
      updated_at: iso,
    })
    .run();
}

beforeEach(() => {
  t = createTestDb();
  clock = new FakeClock(START);
  seedAdmin(t.db, START);
  session = seedSession(t.db, START);
  scheduler = { stopAll: vi.fn(async () => 0), wake: vi.fn() };
  configureWorldApi({ scheduler });
});

afterEach(() => {
  resetWorldApi();
  t.cleanup();
});

describe("worldRoutes（単体テスト）", () => {
  it("TC-UT_WLD-055 世界がないときに GET /world を2回呼んでも、作る世界は1つだけ", async () => {
    const a = app();

    const first = await a.request("/admin/api/world", { headers: headers({ csrf: false }) });
    const second = await a.request("/admin/api/world", { headers: headers({ csrf: false }) });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(((await first.json()) as { worldId: string }).worldId).toBe(
      ((await second.json()) as { worldId: string }).worldId,
    );
    expect(t.db.select().from(worlds).all()).toHaveLength(1);
  });

  it("TC-UT_WLD-056 利用日の行がなければ利用量は 0 で、上限はその世界の world_settings の値を返す", async () => {
    const world = seedWorld();
    t.db
      .update(world_settings)
      .set({ daily_neurons_limit: 5000, daily_runs_limit: 200 })
      .where(eq(world_settings.world_id, world.world_id))
      .run();

    const res = await app().request("/admin/api/world", { headers: headers({ csrf: false }) });

    expect(await res.json()).toMatchObject({
      usage: {
        usageDate: "2026-10-22",
        neurons: 0,
        runs: 0,
        neuronsLimit: 5000,
        runsLimit: 200,
        freeTierNeurons: FREE_TIER_NEURONS,
      },
    });
  });

  it("TC-UT_WLD-057 一時停止中は、時間が進んでも worldTimeSec が増えない", async () => {
    const world = seedWorld();
    addAgent(world.world_id);
    const a = app();
    await a.request("/admin/api/world/start", { method: "POST", headers: headers() });
    await clock.advance(30_000);
    await a.request("/admin/api/world/pause", { method: "POST", headers: headers() });
    await clock.advance(3_600_000);

    const res = await a.request("/admin/api/world", { headers: headers({ csrf: false }) });

    expect(await res.json()).toMatchObject({ state: "paused", worldTimeSec: 30 });
  });

  it("TC-UT_WLD-058 CSRF トークンのない POST /world/start は 403 で、世界の状態を変えない", async () => {
    const world = seedWorld();
    addAgent(world.world_id);

    const res = await app().request("/admin/api/world/start", { method: "POST", headers: headers({ csrf: false }) });

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: "CSRF_INVALID" } });
    expect(findCurrentWorld(t.db)?.state).toBe("preparing");
    expect(t.db.select().from(admin_audit_logs).all()).toHaveLength(0);
    expect(scheduler.wake).not.toHaveBeenCalled();
  });

  it("TC-UT_WLD-059 ログインしていない GET /world は 401 ADMIN_UNAUTHORIZED", async () => {
    seedWorld();

    const res = await app().request("/admin/api/world");

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "ADMIN_UNAUTHORIZED" } });
  });

  it("TC-UT_WLD-060 confirmName のない本文の POST /world/reset は 400 VALIDATION_ERROR（fields.confirmName）", async () => {
    seedWorld();

    const res = await app().request("/admin/api/world/reset", {
      method: "POST",
      headers: headers({ json: true }),
      body: "{}",
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR", fields: { confirmName: expect.any(String) } },
    });
  });
});
