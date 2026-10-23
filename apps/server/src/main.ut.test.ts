// 単体テスト（NOUS-98）。観点表は docs/test/unit/NOUS-98/観点表_main.json
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureLogger } from "../test/helpers/adminTestSupport";
import { seedRunningWorld } from "../test/helpers/generationSeed";
import { createTestDb, type TestDb } from "../test/helpers/testDb";
import { FakeClock } from "./clock/fakeClock";
import { daily_usage, worlds } from "./db/schema";
import type { AppEnv } from "./lib/env";
import { resetWorldApi, resolveScheduler } from "./world/worldRoutes";
import { findCurrentWorld } from "./world/worldService";
import { startApp, type AppScheduler, type StartAppOptions } from "./main";

const START = new Date("2026-10-22T23:58:00.000Z");

let t: TestDb;
let clock: FakeClock;
let backupDir: string;

function makeEnv(): AppEnv {
  return {
    nodeEnv: "test",
    llmMode: "fixed",
    cloudflare: null,
    dbPath: t.path,
    backupDir,
    observerPort: 8080,
    adminPort: 8081,
    fixtureDir: "fixtures/llm",
    logLevel: "info",
    clock: "fake",
  };
}

function stubScheduler(): AppScheduler {
  return { start: vi.fn(), stop: vi.fn(async () => {}), stopAll: vi.fn(async () => 0), wake: vi.fn() };
}

/** サーバー・復旧・バックアップを差し替えた startApp の引数 */
function baseOptions(over: Partial<StartAppOptions> = {}): StartAppOptions {
  return {
    env: makeEnv(),
    clock,
    db: t.db,
    logger: captureLogger().logger,
    recover: vi.fn(() => ({ closedEvents: 0, worldPatched: false, deletedSessions: 0 })),
    backup: vi.fn(() => join(backupDir, "aisns-20261022-2358.db")),
    startObserver: () => ({ close: () => {} }),
    startAdmin: () => ({ close: () => {} }),
    createScheduler: () => stubScheduler(),
    ...over,
  };
}

beforeEach(() => {
  t = createTestDb();
  clock = new FakeClock(START);
  backupDir = mkdtempSync(join(tmpdir(), "nous-main-ut-"));
});

afterEach(() => {
  resetWorldApi();
  t.cleanup();
  rmSync(backupDir, { recursive: true, force: true });
});

describe("main（単体テスト）", () => {
  it("TC-UT_BOOT-001 現在の世界がすでにあるときは初回の世界を作らず、その世界のまま起動する", async () => {
    const worldId = seedRunningWorld(t.db);

    const app = await startApp(baseOptions());
    await app.close();

    expect(t.db.select().from(worlds).all()).toHaveLength(1);
    expect(findCurrentWorld(t.db)?.world_id).toBe(worldId);
  });

  it("TC-UT_BOOT-002 recover と backup に起動時の時刻を渡し、backup には env.backupDir を渡す", async () => {
    const recover = vi.fn(() => ({ closedEvents: 0, worldPatched: false, deletedSessions: 0 }));
    const backup = vi.fn(() => join(backupDir, "aisns-20261022-2358.db"));

    const app = await startApp(baseOptions({ recover, backup }));
    await app.close();

    expect(recover).toHaveBeenCalledWith(expect.objectContaining({ db: t.db, clock }), START);
    expect(backup).toHaveBeenCalledWith(expect.objectContaining({ db: t.db, backupDir }), START);
  });

  it("TC-UT_BOOT-003 close を 2 回呼んでも、Scheduler の停止とサーバーの終了は 1 回だけ", async () => {
    const scheduler = stubScheduler();
    const observerClose = vi.fn();
    const adminClose = vi.fn();
    const app = await startApp(
      baseOptions({
        createScheduler: () => scheduler,
        startObserver: () => ({ close: observerClose }),
        startAdmin: () => ({ close: adminClose }),
      }),
    );

    await app.close();
    await app.close();

    expect(scheduler.stop).toHaveBeenCalledTimes(1);
    expect(observerClose).toHaveBeenCalledTimes(1);
    expect(adminClose).toHaveBeenCalledTimes(1);
  });

  it("TC-UT_BOOT-004 管理サーバーの起動に失敗したら例外を投げ、起動済みの観察サーバーを閉じ、Scheduler を動かさない", async () => {
    const scheduler = stubScheduler();
    const observerClose = vi.fn();

    const starting = startApp(
      baseOptions({
        createScheduler: () => scheduler,
        startObserver: () => ({ close: observerClose }),
        startAdmin: () => {
          throw new Error("admin bind failed");
        },
      }),
    );

    await expect(starting).rejects.toThrow("admin bind failed");
    expect(scheduler.start).not.toHaveBeenCalled();
    expect(observerClose).toHaveBeenCalledTimes(1);
    expect(clock.pendingCount()).toBe(0);
  });

  it("TC-UT_BOOT-005 options.db を渡して起動に失敗したときは、渡された DB を閉じない", async () => {
    const starting = startApp(
      baseOptions({
        recover: () => {
          throw new Error("recover failed");
        },
      }),
    );

    await expect(starting).rejects.toThrow("recover failed");
    expect(t.db.$client.open).toBe(true);
  });

  it("TC-UT_BOOT-006 起動後、FakeClock で 60 秒ごとに生存時刻が更新され、00:00:00.000 UTC で日の区切りが走る（23:59:59.999 では走らない）", async () => {
    seedRunningWorld(t.db, { runningSince: START.toISOString() });
    const app = await startApp(baseOptions());

    await clock.advance(60_000);
    const heartbeatAt = findCurrentWorld(t.db)?.heartbeat_at;
    await clock.advanceTo(new Date("2026-10-22T23:59:59.999Z"));
    const datesBefore = t.db.select().from(daily_usage).all().length;
    await clock.advanceTo(new Date("2026-10-23T00:00:00.000Z"));
    const datesAfter = t.db.select().from(daily_usage).where(eq(daily_usage.usage_date, "2026-10-23")).all().length;
    await app.close();

    expect(heartbeatAt).toBe("2026-10-22T23:59:00.000Z");
    expect(datesBefore).toBe(0);
    expect(datesAfter).toBe(1);
  });

  it("TC-UT_BOOT-007 createScheduler を渡さないときは、既定の Scheduler を作って管理 API に渡し、close で止める", async () => {
    const options = baseOptions();
    delete options.createScheduler;

    const app = await startApp(options);
    const configured = resolveScheduler(captureLogger().logger);
    await app.close();

    expect(configured).toBe(app.scheduler);
    expect(typeof (app.scheduler as { runningCount?: unknown }).runningCount).toBe("function");
    expect(clock.pendingCount()).toBe(0);
  });
});
