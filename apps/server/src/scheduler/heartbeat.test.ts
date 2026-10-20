import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureLogger } from "../../test/helpers/adminTestSupport";
import { createTestDb, type TestDb } from "../../test/helpers/testDb";
import { FakeClock } from "../clock/fakeClock";
import { worlds } from "../db/schema";
import { withTx } from "../db/tx";
import { createInitialWorld, findCurrentWorld } from "../world/worldService";
import { beat, scheduleHeartbeat } from "./heartbeat";

const START = new Date("2026-10-22T00:00:00.000Z");

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

describe("heartbeat", () => {
  it("TC-NOUS60_DEV-14 世界が running でなければ何もしない", () => {
    const world = withTx(t.db, (tx) => createInitialWorld(tx, START));
    const { logger } = captureLogger();

    // preparing のまま
    expect(beat({ db: t.db, clock, scheduler, logger }, START)).toEqual({
      updated: false,
      corrected: false,
      woke: false,
    });

    // paused の場合
    t.db
      .update(worlds)
      .set({ state: "paused", stop_reason: "manual_pause", running_since: null })
      .where(eq(worlds.world_id, world.world_id))
      .run();
    expect(beat({ db: t.db, clock, scheduler, logger }, START)).toEqual({
      updated: false,
      corrected: false,
      woke: false,
    });
    expect(scheduler.wake).not.toHaveBeenCalled();
  });

  it("TC-NOUS60_DEV-15 前回の heartbeat_at から 180 秒以内なら heartbeat_at だけを更新する", () => {
    const world = withTx(t.db, (tx) => createInitialWorld(tx, START));
    t.db
      .update(worlds)
      .set({
        state: "running",
        world_elapsed_sec: 50,
        running_since: "2026-10-22T00:00:00.000Z",
        heartbeat_at: "2026-10-22T00:05:00.000Z",
        next_cycle_at: "2026-10-22T00:20:00.000Z",
      })
      .where(eq(worlds.world_id, world.world_id))
      .run();

    const now = new Date("2026-10-22T00:08:00.000Z"); // ちょうど 180 秒後
    const { logger, lines } = captureLogger();
    const res = beat({ db: t.db, clock, scheduler, logger }, now);

    expect(res).toEqual({ updated: true, corrected: false, woke: false });
    const updated = findCurrentWorld(t.db)!;
    expect(updated.world_elapsed_sec).toBe(50);
    expect(updated.running_since).toBe("2026-10-22T00:00:00.000Z");
    expect(updated.heartbeat_at).toBe("2026-10-22T00:08:00.000Z");
    expect(lines().some((l) => l.level === "warn")).toBe(false);
    expect(scheduler.wake).not.toHaveBeenCalled();
  });

  it("TC-NOUS60_DEV-16 前回の heartbeat_at から 180 秒を超えて古ければ世界内時間を補正し running_since を now にする", () => {
    const world = withTx(t.db, (tx) => createInitialWorld(tx, START));
    t.db
      .update(worlds)
      .set({
        state: "running",
        world_elapsed_sec: 100,
        running_since: "2026-10-22T00:00:00.000Z",
        heartbeat_at: "2026-10-22T00:10:00.000Z",
        next_cycle_at: "2026-10-22T03:00:00.000Z",
      })
      .where(eq(worlds.world_id, world.world_id))
      .run();

    const now = new Date("2026-10-22T02:00:00.000Z");
    const { logger, lines } = captureLogger();
    const res = beat({ db: t.db, clock, scheduler, logger }, now);

    expect(res).toEqual({ updated: true, corrected: true, woke: false });
    const updated = findCurrentWorld(t.db)!;
    // 100 + (00:10 - 00:00 の 600 秒) = 700
    expect(updated.world_elapsed_sec).toBe(700);
    expect(updated.running_since).toBe("2026-10-22T02:00:00.000Z");
    expect(updated.heartbeat_at).toBe("2026-10-22T02:00:00.000Z");
    expect(lines().some((l) => l.level === "warn")).toBe(true);
  });

  it("TC-NOUS60_DEV-17 next_cycle_at を過ぎていれば scheduler.wake を呼ぶ", () => {
    const world = withTx(t.db, (tx) => createInitialWorld(tx, START));
    t.db
      .update(worlds)
      .set({
        state: "running",
        world_elapsed_sec: 0,
        running_since: "2026-10-22T00:00:00.000Z",
        heartbeat_at: "2026-10-22T00:10:00.000Z",
        next_cycle_at: "2026-10-22T00:20:00.000Z",
      })
      .where(eq(worlds.world_id, world.world_id))
      .run();

    const now = new Date("2026-10-22T00:20:00.000Z");
    const { logger } = captureLogger();
    const res = beat({ db: t.db, clock, scheduler, logger }, now);

    expect(res).toEqual({ updated: true, corrected: true, woke: true });
    expect(scheduler.wake).toHaveBeenCalledTimes(1);
  });

  it("TC-NOUS60_DEV-18 scheduleHeartbeat で FakeClock を 60 秒進めるごとに beat が走る", async () => {
    const world = withTx(t.db, (tx) => createInitialWorld(tx, START));
    t.db
      .update(worlds)
      .set({
        state: "running",
        running_since: START.toISOString(),
        heartbeat_at: START.toISOString(),
      })
      .where(eq(worlds.world_id, world.world_id))
      .run();

    const { logger } = captureLogger();
    const cancel = scheduleHeartbeat({ db: t.db, clock, scheduler, logger });

    await clock.advance(60_000);
    expect(findCurrentWorld(t.db)!.heartbeat_at).toBe("2026-10-22T00:01:00.000Z");

    await clock.advance(60_000);
    expect(findCurrentWorld(t.db)!.heartbeat_at).toBe("2026-10-22T00:02:00.000Z");

    cancel();
    await clock.advance(60_000);
    expect(findCurrentWorld(t.db)!.heartbeat_at).toBe("2026-10-22T00:02:00.000Z");
  });
});
