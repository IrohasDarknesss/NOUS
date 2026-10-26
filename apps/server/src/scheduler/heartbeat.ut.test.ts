// 単体テスト（NOUS-98）。観点表は docs/test/unit/NOUS-98/観点表_daily.json
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureLogger } from "../../test/helpers/adminTestSupport";
import { createTestDb, type TestDb } from "../../test/helpers/testDb";
import { FakeClock } from "../clock/fakeClock";
import { closeDb } from "../db/client";
import { worlds } from "../db/schema";
import { withTx } from "../db/tx";
import { createInitialWorld, findCurrentWorld } from "../world/worldService";
import { beat, HEARTBEAT_INTERVAL_MS, scheduleHeartbeat } from "./heartbeat";

const START = new Date("2026-10-22T09:00:00.000Z");

let t: TestDb;
let clock: FakeClock;
let scheduler: { wake: ReturnType<typeof vi.fn> };

beforeEach(() => {
  t = createTestDb();
  clock = new FakeClock(START);
  scheduler = { wake: vi.fn() };
});

afterEach(() => {
  t.cleanup();
});

/** START から running の世界を作る */
function seedRunning(values: Partial<typeof worlds.$inferInsert> = {}): string {
  const world = withTx(t.db, (tx) => createInitialWorld(tx, START));
  t.db
    .update(worlds)
    .set({
      state: "running",
      world_elapsed_sec: 0,
      running_since: START.toISOString(),
      heartbeat_at: START.toISOString(),
      ...values,
    })
    .where(eq(worlds.world_id, world.world_id))
    .run();
  return world.world_id;
}

describe("heartbeat（単体テスト）", () => {
  it.each([
    [180, false],
    [181, true],
  ])(
    "TC-UT_SCH-038 前回の heartbeat_at からの空白が 180 秒ちょうどなら補正せず、181 秒なら補正する（%i 秒 → %s）",
    (gapSec, corrected) => {
      seedRunning();
      const { logger } = captureLogger();
      const now = new Date(START.getTime() + gapSec * 1000);

      const res = beat({ db: t.db, clock, scheduler, logger }, now);

      expect(res).toMatchObject({ updated: true, corrected });
      expect(findCurrentWorld(t.db)?.running_since).toBe(corrected ? now.toISOString() : START.toISOString());
      expect(findCurrentWorld(t.db)?.heartbeat_at).toBe(now.toISOString());
    },
  );

  it.each([
    [-1, false],
    [0, true],
  ])(
    "TC-UT_SCH-039 next_cycle_at の 1 ミリ秒前では wake を呼ばず、ちょうどで呼ぶ（next_cycle_at との差 %i ミリ秒 → %s）",
    (diffMs, woke) => {
      const next = new Date(START.getTime() + 60_000);
      seedRunning({ next_cycle_at: next.toISOString() });
      const { logger } = captureLogger();

      const res = beat({ db: t.db, clock, scheduler, logger }, new Date(next.getTime() + diffMs));

      expect(res.woke).toBe(woke);
      expect(scheduler.wake).toHaveBeenCalledTimes(woke ? 1 : 0);
    },
  );

  it("TC-UT_SCH-040 next_cycle_at が NULL なら wake を呼ばない", () => {
    seedRunning({ next_cycle_at: null });
    const { logger } = captureLogger();

    const res = beat({ db: t.db, clock, scheduler, logger }, new Date(START.getTime() + 60_000));

    expect(res).toEqual({ updated: true, corrected: false, woke: false });
    expect(scheduler.wake).not.toHaveBeenCalled();
  });

  it("TC-UT_SCH-041 現在の世界がないときは何もしない", () => {
    const { logger } = captureLogger();

    const res = beat({ db: t.db, clock, scheduler, logger }, START);

    expect(res).toEqual({ updated: false, corrected: false, woke: false });
    expect(scheduler.wake).not.toHaveBeenCalled();
  });

  it("TC-UT_SCH-042 beat が例外になってもタイマーは止まらず、次の 60 秒でも呼ばれて error を記録する", async () => {
    const { logger, lines } = captureLogger();
    const cancel = scheduleHeartbeat({ db: t.db, clock, scheduler, logger });
    closeDb(t.db);

    await clock.advance(HEARTBEAT_INTERVAL_MS);
    const errorsFirst = lines().filter((l) => l.level === "error").length;
    await clock.advance(HEARTBEAT_INTERVAL_MS);
    const errorsSecond = lines().filter((l) => l.level === "error").length;
    cancel();

    expect(errorsFirst).toBe(1);
    expect(errorsSecond).toBe(2);
  });

  it("TC-UT_SCH-043 スリープからの復帰（FakeClock.jump で 10 分）で、最後の生存時刻までを世界内時間に足し、warn を記録する", async () => {
    seedRunning();
    const { logger, lines } = captureLogger();
    const cancel = scheduleHeartbeat({ db: t.db, clock, scheduler, logger });

    await clock.advance(HEARTBEAT_INTERVAL_MS);
    await clock.jump(10 * 60_000);
    cancel();

    const resumedAt = new Date(START.getTime() + HEARTBEAT_INTERVAL_MS + 10 * 60_000).toISOString();
    expect(findCurrentWorld(t.db)).toMatchObject({
      world_elapsed_sec: 60,
      running_since: resumedAt,
      heartbeat_at: resumedAt,
    });
    expect(lines().filter((l) => l.level === "warn")).toHaveLength(1);
  });
});
