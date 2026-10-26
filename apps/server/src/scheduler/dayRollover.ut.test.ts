// 単体テスト（NOUS-98）。観点表は docs/test/unit/NOUS-98/観点表_daily.json
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureLogger } from "../../test/helpers/adminTestSupport";
import { createTestDb, type TestDb } from "../../test/helpers/testDb";
import { FakeClock } from "../clock/fakeClock";
import { closeDb } from "../db/client";
import { daily_metrics, daily_usage } from "../db/schema";
import { withTx } from "../db/tx";
import { createInitialWorld, findCurrentWorld } from "../world/worldService";
import { rolloverDay, scheduleDayRollover } from "./dayRollover";

const BEFORE_MIDNIGHT = new Date("2026-10-22T23:59:59.999Z");
const MIDNIGHT = new Date("2026-10-23T00:00:00.000Z");

let t: TestDb;
let clock: FakeClock;
let backupDir: string;
let scheduler: { wake: ReturnType<typeof vi.fn> };

beforeEach(() => {
  t = createTestDb();
  clock = new FakeClock(new Date("2026-10-22T23:59:59.000Z"));
  backupDir = mkdtempSync(join(tmpdir(), "nous-rollover-ut-"));
  scheduler = { wake: vi.fn() };
});

afterEach(() => {
  t.cleanup();
  rmSync(backupDir, { recursive: true, force: true });
});

function usageDates(): string[] {
  return t.db
    .select()
    .from(daily_usage)
    .all()
    .map((r) => r.usage_date)
    .sort();
}

describe("dayRollover（単体テスト）", () => {
  it("TC-UT_SCH-024 scheduleDayRollover は 23:59:59.999 では走らず、00:00:00.000 UTC で走る", async () => {
    withTx(t.db, (tx) => createInitialWorld(tx, clock.now()));
    const { logger } = captureLogger();
    const cancel = scheduleDayRollover({ db: t.db, clock, scheduler, backupDir, logger });

    await clock.advanceTo(BEFORE_MIDNIGHT);
    const datesBefore = usageDates();
    await clock.advanceTo(MIDNIGHT);
    const datesAfter = usageDates();
    cancel();

    expect(datesBefore).toEqual([]);
    expect(datesAfter).toEqual(["2026-10-23"]);
  });

  it.each([
    ["2026-10-22T23:59:59.999Z", "2026-10-22"],
    ["2026-10-23T00:00:00.000Z", "2026-10-23"],
  ])("TC-UT_SCH-025 rolloverDay の利用日は now の UTC の日付になる（%s → %s）", (nowIso, expected) => {
    withTx(t.db, (tx) => createInitialWorld(tx, clock.now()));
    const { logger } = captureLogger();

    const res = rolloverDay({ db: t.db, clock, scheduler, backupDir, logger }, new Date(nowIso));

    expect(res.usageDate).toBe(expected);
    expect(usageDates()).toEqual([expected]);
    expect(
      t.db
        .select()
        .from(daily_metrics)
        .all()
        .map((r) => r.usage_date),
    ).toEqual([expected]);
  });

  it("TC-UT_SCH-026 現在の世界がないときは daily_usage だけを作り、resumed は false で wake を呼ばない", () => {
    const { logger } = captureLogger();

    const res = rolloverDay({ db: t.db, clock, scheduler, backupDir, logger }, MIDNIGHT);

    expect(res.resumed).toBe(false);
    expect(usageDates()).toEqual(["2026-10-23"]);
    expect(t.db.select().from(daily_metrics).all()).toHaveLength(0);
    expect(scheduler.wake).not.toHaveBeenCalled();
  });

  it("TC-UT_SCH-027 preparing の世界は状態を変えず、その世界の daily_metrics を作る", () => {
    const world = withTx(t.db, (tx) => createInitialWorld(tx, clock.now()));
    const { logger } = captureLogger();

    const res = rolloverDay({ db: t.db, clock, scheduler, backupDir, logger }, MIDNIGHT);

    expect(res.resumed).toBe(false);
    expect(findCurrentWorld(t.db)?.state).toBe("preparing");
    const metrics = t.db.select().from(daily_metrics).where(eq(daily_metrics.world_id, world.world_id)).all();
    expect(metrics.map((r) => r.usage_date)).toEqual(["2026-10-23"]);
    expect(scheduler.wake).not.toHaveBeenCalled();
  });

  it("TC-UT_SCH-028 日の区切りの処理が例外になってもタイマーは止まらず、翌日の 00:00 UTC にも呼ばれて error を記録する", async () => {
    const { logger, lines } = captureLogger();
    const cancel = scheduleDayRollover({ db: t.db, clock, scheduler, backupDir, logger });
    closeDb(t.db);

    await clock.advanceTo(MIDNIGHT);
    const errorsFirst = lines().filter((l) => l.level === "error").length;
    await clock.advance(24 * 60 * 60 * 1000);
    const errorsSecond = lines().filter((l) => l.level === "error").length;
    cancel();

    expect(errorsFirst).toBe(1);
    expect(errorsSecond).toBe(2);
    expect(clock.pendingCount()).toBe(0);
  });
});
