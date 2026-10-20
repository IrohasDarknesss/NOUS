import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureLogger } from "../test/helpers/adminTestSupport";
import { createTestDb, type TestDb } from "../test/helpers/testDb";
import { FakeClock } from "./clock/fakeClock";
import type { AppEnv } from "./lib/env";
import { BackupError } from "./scheduler/backup";
import { resetWorldApi, resolveScheduler } from "./world/worldRoutes";
import { findCurrentWorld } from "./world/worldService";
import { startApp, type AppScheduler } from "./main";

const START = new Date("2026-10-22T00:00:00.000Z");

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

beforeEach(() => {
  t = createTestDb();
  clock = new FakeClock(START);
  backupDir = mkdtempSync(join(tmpdir(), "nous-main-test-"));
});

afterEach(() => {
  resetWorldApi();
  t.cleanup();
  rmSync(backupDir, { recursive: true, force: true });
});

describe("main (startApp)", () => {
  it("TC-NOUS60_DEV-19 startApp の順が recover → backup → observer → admin → scheduler.start であり、初回の世界が作られ、Scheduler が管理 API に渡る", async () => {
    const order: string[] = [];
    const { logger } = captureLogger();
    const scheduler: AppScheduler = {
      start: () => {
        order.push("scheduler.start");
      },
      stop: async () => {},
      stopAll: async () => 0,
      wake: () => {},
    };

    const app = await startApp({
      env: makeEnv(),
      clock,
      db: t.db,
      logger,
      recover: () => {
        // recover が呼ばれた時点で初回の世界が作られていることも確かめる
        expect(findCurrentWorld(t.db)?.state).toBe("preparing");
        order.push("recover");
        return { closedEvents: 0, worldPatched: false, deletedSessions: 0 };
      },
      backup: () => {
        order.push("backup");
        return join(backupDir, "aisns-20261022-0000.db");
      },
      startObserver: (_db, _clock, port) => {
        expect(port).toBe(8080);
        order.push("observer");
        return { close: () => {} };
      },
      startAdmin: (_deps, port) => {
        expect(port).toBe(8081);
        order.push("admin");
        return { close: () => {} };
      },
      createScheduler: () => scheduler,
    });

    try {
      expect(order).toEqual(["recover", "backup", "observer", "admin", "scheduler.start"]);
      expect(findCurrentWorld(t.db)?.name).toBe("世界 2026-10-22");
      // 管理 API（世界の操作）に Scheduler が渡っている（configureWorldApi）
      expect(resolveScheduler(logger)).toBe(scheduler);
    } finally {
      await app.close();
    }
  });

  it("TC-NOUS60_DEV-20 バックアップが失敗してもエラーを記録して起動が続く", async () => {
    const order: string[] = [];
    const { logger, lines } = captureLogger();

    const app = await startApp({
      env: makeEnv(),
      clock,
      db: t.db,
      logger,
      recover: () => {
        order.push("recover");
        return { closedEvents: 0, worldPatched: false, deletedSessions: 0 };
      },
      backup: () => {
        order.push("backup");
        throw new BackupError("disk full");
      },
      startObserver: () => {
        order.push("observer");
        return { close: () => {} };
      },
      startAdmin: () => {
        order.push("admin");
        return { close: () => {} };
      },
      createScheduler: () => ({
        start: () => {
          order.push("scheduler.start");
        },
        stop: async () => {},
        stopAll: async () => 0,
        wake: () => {},
      }),
    });

    try {
      expect(order).toEqual(["recover", "backup", "observer", "admin", "scheduler.start"]);
      expect(lines().some((l) => l.level === "error")).toBe(true);
    } finally {
      await app.close();
    }
  });

  it("TC-NOUS60_DEV-21 recover が失敗したらサーバーや Scheduler を起動せず例外を投げる", async () => {
    const order: string[] = [];
    const { logger } = captureLogger();

    await expect(
      startApp({
        env: makeEnv(),
        clock,
        db: t.db,
        logger,
        recover: () => {
          order.push("recover");
          throw new Error("recover failed");
        },
        backup: () => {
          order.push("backup");
          return "";
        },
        startObserver: () => {
          order.push("observer");
          return { close: () => {} };
        },
        startAdmin: () => {
          order.push("admin");
          return { close: () => {} };
        },
      }),
    ).rejects.toThrow("recover failed");

    expect(order).toEqual(["recover"]);
  });

  it("TC-NOUS60_DEV-22 close でタイマー・scheduler・両サーバー・DB が止まる", async () => {
    const events: string[] = [];
    const { logger } = captureLogger();
    const scheduler: AppScheduler = {
      start: vi.fn(),
      stop: vi.fn(async () => {
        events.push("scheduler.stop");
      }),
      stopAll: vi.fn(async () => 0),
      wake: vi.fn(),
    };

    const app = await startApp({
      env: makeEnv(),
      clock,
      db: t.db,
      logger,
      recover: () => ({ closedEvents: 0, worldPatched: false, deletedSessions: 0 }),
      backup: () => join(backupDir, "aisns-20261022-0000.db"),
      startObserver: () => ({
        close: async () => {
          events.push("observer.close");
        },
      }),
      startAdmin: () => ({
        close: async () => {
          events.push("admin.close");
        },
      }),
      createScheduler: () => scheduler,
    });

    // B08 と B02 の 2 つのタイマーが張られている
    expect(clock.pendingCount()).toBe(2);

    await app.close();

    expect(clock.pendingCount()).toBe(0);
    expect(events).toEqual(["scheduler.stop", "admin.close", "observer.close"]);
    expect(t.db.$client.open).toBe(false);
  });
});
