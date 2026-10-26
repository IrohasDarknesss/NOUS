// 単体テスト（NOUS-98）。観点表は docs/test/unit/NOUS-98/観点表_daily.json
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedAgent, seedEvent, seedWorld } from "../../test/helpers/generationSeed";
import { createTestDb, type TestDb } from "../../test/helpers/testDb";
import { FakeClock } from "../clock/fakeClock";
import { generation_events, worlds } from "../db/schema";
import { withTx } from "../db/tx";
import { createInitialWorld, findCurrentWorld } from "../world/worldService";
import { recoverOnStartup } from "./startupRecovery";

const NOW = new Date("2026-10-23T05:00:00.000Z");

let t: TestDb;
let clock: FakeClock;

beforeEach(() => {
  t = createTestDb();
  clock = new FakeClock(NOW);
});

afterEach(() => {
  t.cleanup();
});

describe("startupRecovery（単体テスト）", () => {
  it("TC-UT_SCH-034 現在の世界がない（archived だけ）ときも、その世界の running の生成イベントを interrupted で閉じ、worldPatched は false", () => {
    const worldId = seedWorld(t.db);
    const eventId = seedEvent(t.db, worldId, seedAgent(t.db, worldId, "minato"));
    t.db
      .update(worlds)
      .set({ state: "archived", archived_at: NOW.toISOString() })
      .where(eq(worlds.world_id, worldId))
      .run();

    const res = recoverOnStartup({ db: t.db, clock }, NOW);

    expect(res).toMatchObject({ closedEvents: 1, worldPatched: false });
    const row = t.db.select().from(generation_events).where(eq(generation_events.event_id, eventId)).get();
    expect(row).toMatchObject({ status: "interrupted", failure_kind: "interrupted", finished_at: NOW.toISOString() });
  });

  it("TC-UT_SCH-035 paused の世界は世界内時間を補正しない", () => {
    const world = withTx(t.db, (tx) => createInitialWorld(tx, NOW));
    t.db
      .update(worlds)
      .set({ state: "paused", stop_reason: "manual_pause", world_elapsed_sec: 300, running_since: null })
      .where(eq(worlds.world_id, world.world_id))
      .run();

    const res = recoverOnStartup({ db: t.db, clock }, NOW);

    expect(res.worldPatched).toBe(false);
    expect(findCurrentWorld(t.db)).toMatchObject({ state: "paused", world_elapsed_sec: 300, running_since: null });
  });

  it("TC-UT_SCH-036 heartbeat_at が NULL の running の世界は running_since までで補正し（足す秒は 0）、running_since と heartbeat_at を now にする", () => {
    const world = withTx(t.db, (tx) => createInitialWorld(tx, NOW));
    t.db
      .update(worlds)
      .set({
        state: "running",
        world_elapsed_sec: 120,
        running_since: "2026-10-23T00:00:00.000Z",
        heartbeat_at: null,
      })
      .where(eq(worlds.world_id, world.world_id))
      .run();

    const res = recoverOnStartup({ db: t.db, clock }, NOW);

    expect(res.worldPatched).toBe(true);
    expect(findCurrentWorld(t.db)).toMatchObject({
      state: "running",
      world_elapsed_sec: 120,
      running_since: NOW.toISOString(),
      heartbeat_at: NOW.toISOString(),
    });
  });

  it("TC-UT_SCH-037 running の生成イベントも期限切れのセッションもないときは、どの件数も 0 を返す", () => {
    withTx(t.db, (tx) => createInitialWorld(tx, NOW));

    const res = recoverOnStartup({ db: t.db, clock }, NOW);

    expect(res).toEqual({ closedEvents: 0, worldPatched: false, deletedSessions: 0 });
  });
});
