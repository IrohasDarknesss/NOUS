import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureLogger } from "../../test/helpers/adminTestSupport";
import { createTestDb, type TestDb } from "../../test/helpers/testDb";
import { FakeClock } from "../clock/fakeClock";
import { daily_metrics, daily_usage, worlds } from "../db/schema";
import { withTx } from "../db/tx";
import { createInitialWorld, findCurrentWorld } from "../world/worldService";
import { rolloverDay, scheduleDayRollover } from "./dayRollover";

const START = new Date("2026-10-22T00:00:00.000Z");

let t: TestDb;
let clock: FakeClock;
let backupDir: string;
let scheduler: { wake: ReturnType<typeof vi.fn> };

beforeEach(() => {
  t = createTestDb();
  clock = new FakeClock(START);
  backupDir = mkdtempSync(join(tmpdir(), "nous-rollover-test-"));
  scheduler = { wake: vi.fn() };
});

afterEach(() => {
  t.cleanup();
  rmSync(backupDir, { recursive: true, force: true });
});

describe("dayRollover", () => {
  it("TC-NOUS60_DEV-05 00:00 UTC で daily_usage と現在の世界の daily_metrics の新しい日の行ができる", () => {
    const world = withTx(t.db, (tx) => createInitialWorld(tx, START));
    const { logger } = captureLogger();

    const res = rolloverDay({ db: t.db, clock, scheduler, backupDir, logger }, START);

    expect(res.usageDate).toBe("2026-10-22");
    expect(res.resumed).toBe(false);
    expect(res.backupPath).toBe(join(backupDir, "aisns-20261022-0000.db"));
    expect(existsSync(res.backupPath!)).toBe(true);

    const usage = t.db.select().from(daily_usage).where(eq(daily_usage.usage_date, "2026-10-22")).get();
    expect(usage).toEqual({
      usage_date: "2026-10-22",
      calls: 0,
      runs: 0,
      prompt_tokens: 0,
      completion_tokens: 0,
      neurons: 0,
    });

    const metrics = t.db.select().from(daily_metrics).where(eq(daily_metrics.world_id, world.world_id)).get();
    expect(metrics).toEqual({
      world_id: world.world_id,
      usage_date: "2026-10-22",
      runs: 0,
      posts: 0,
      replies: 0,
      replied_posts: 0,
      likes: 0,
      follows: 0,
      nones: 0,
      failures: 0,
    });
  });

  it("TC-NOUS60_DEV-06 同じ利用日で 2 回呼んでも重複せず既存の値も壊さない", () => {
    const world = withTx(t.db, (tx) => createInitialWorld(tx, START));
    const { logger } = captureLogger();
    const deps = { db: t.db, clock, scheduler, backupDir, logger };

    rolloverDay(deps, START);
    t.db.update(daily_usage).set({ runs: 12, neurons: 150.5 }).where(eq(daily_usage.usage_date, "2026-10-22")).run();
    t.db.update(daily_metrics).set({ posts: 5 }).where(eq(daily_metrics.world_id, world.world_id)).run();

    rolloverDay(deps, START);

    expect(t.db.select().from(daily_usage).all()).toHaveLength(1);
    expect(t.db.select().from(daily_usage).get()).toMatchObject({ runs: 12, neurons: 150.5 });
    expect(t.db.select().from(daily_metrics).all()).toHaveLength(1);
    expect(t.db.select().from(daily_metrics).get()).toMatchObject({ posts: 5 });
  });

  it("TC-NOUS60_DEV-07 limit_stopped の世界が running に戻り scheduler.wake が呼ばれる", () => {
    const world = withTx(t.db, (tx) => createInitialWorld(tx, START));
    t.db
      .update(worlds)
      .set({
        state: "limit_stopped",
        stop_reason: "neurons_limit",
        running_since: null,
        heartbeat_at: "2026-10-21T20:00:00.000Z",
      })
      .where(eq(worlds.world_id, world.world_id))
      .run();

    const { logger } = captureLogger();
    const res = rolloverDay({ db: t.db, clock, scheduler, backupDir, logger }, START);

    expect(res.resumed).toBe(true);
    expect(scheduler.wake).toHaveBeenCalledTimes(1);

    const updated = findCurrentWorld(t.db)!;
    expect(updated.state).toBe("running");
    expect(updated.stop_reason).toBeNull();
    expect(updated.running_since).toBe(START.toISOString());
    expect(updated.heartbeat_at).toBe(START.toISOString());
  });

  it("TC-NOUS60_DEV-08 running・paused・emergency_stopped の世界は状態が変わらず wake も呼ばれない", () => {
    const world = withTx(t.db, (tx) => createInitialWorld(tx, START));
    const { logger } = captureLogger();
    const deps = { db: t.db, clock, scheduler, backupDir, logger };

    // running の場合
    const earlierIso = "2026-10-21T23:00:00.000Z";
    t.db
      .update(worlds)
      .set({ state: "running", running_since: earlierIso, heartbeat_at: earlierIso })
      .where(eq(worlds.world_id, world.world_id))
      .run();
    expect(rolloverDay(deps, START).resumed).toBe(false);
    expect(findCurrentWorld(t.db)!.running_since).toBe(earlierIso);

    // paused の場合
    t.db
      .update(worlds)
      .set({ state: "paused", running_since: null, stop_reason: "manual_pause" })
      .where(eq(worlds.world_id, world.world_id))
      .run();
    expect(rolloverDay(deps, START).resumed).toBe(false);
    expect(findCurrentWorld(t.db)!.state).toBe("paused");

    // emergency_stopped の場合
    t.db
      .update(worlds)
      .set({ state: "emergency_stopped", running_since: null, stop_reason: "emergency" })
      .where(eq(worlds.world_id, world.world_id))
      .run();
    expect(rolloverDay(deps, START).resumed).toBe(false);
    expect(findCurrentWorld(t.db)!.state).toBe("emergency_stopped");

    expect(scheduler.wake).not.toHaveBeenCalled();
  });

  it("TC-NOUS60_DEV-09 バックアップが失敗しても例外にならず backupPath が null になりエラーが記録される", () => {
    withTx(t.db, (tx) => createInitialWorld(tx, START));
    const { logger, lines } = captureLogger();

    // backupDir のパスに通常のファイルを置いて mkdirSync を失敗させる
    const invalidBackupDir = join(backupDir, "not-a-dir");
    writeFileSync(invalidBackupDir, "file");

    const res = rolloverDay({ db: t.db, clock, scheduler, backupDir: invalidBackupDir, logger }, START);

    expect(res.usageDate).toBe("2026-10-22");
    expect(res.backupPath).toBeNull();
    expect(t.db.select().from(daily_usage).all()).toHaveLength(1);
    expect(lines().some((l) => l.level === "error")).toBe(true);
  });

  it("TC-NOUS60_DEV-10 scheduleDayRollover で FakeClock を 23:59 から 00:00 UTC を越えて進めると rolloverDay が走り、翌日の 00:00 でも再び走る", async () => {
    const start2359 = new Date("2026-10-21T23:59:00.000Z");
    clock = new FakeClock(start2359);
    const world = withTx(t.db, (tx) => createInitialWorld(tx, start2359));
    t.db
      .update(worlds)
      .set({ state: "limit_stopped", stop_reason: "runs_limit", running_since: null })
      .where(eq(worlds.world_id, world.world_id))
      .run();

    const { logger } = captureLogger();
    const cancel = scheduleDayRollover({ db: t.db, clock, scheduler, backupDir, logger });

    // 23:59 → 00:00 UTC（1 分進める）
    await clock.advance(60_000);
    expect(
      t.db
        .select()
        .from(daily_usage)
        .all()
        .map((r) => r.usage_date),
    ).toEqual(["2026-10-22"]);
    expect(findCurrentWorld(t.db)!.state).toBe("running");
    expect(scheduler.wake).toHaveBeenCalledTimes(1);

    // 翌日の 00:00 UTC（24 時間進める）
    await clock.advance(24 * 60 * 60 * 1000);
    expect(
      t.db
        .select()
        .from(daily_usage)
        .all()
        .map((r) => r.usage_date)
        .sort(),
    ).toEqual(["2026-10-22", "2026-10-23"]);

    cancel();
    await clock.advance(24 * 60 * 60 * 1000);
    expect(t.db.select().from(daily_usage).all()).toHaveLength(2);
  });
});
