// 単体テスト（NOUS-97）。観点表は docs/test/unit/NOUS-97/観点表_rules.json
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../test/helpers/testDb";
import { worlds } from "../db/schema";
import { withTx } from "../db/tx";
import { getWorldTimeSec, heartbeatPatch, settleWorldTime, startupPatch } from "./worldTime";

const SINCE = "2026-10-22T00:00:00.000Z";
const at = (iso: string): Date => new Date(iso);

describe("worldTime（単体テスト）", () => {
  it("TC-UT_WLD-005 running で now が running_since より前なら、確定分だけを返す（負にしない）", () => {
    const world = { state: "running", world_elapsed_sec: 100, running_since: SINCE, heartbeat_at: SINCE };

    const sec = getWorldTimeSec(world, at("2026-10-21T23:59:00.000Z"));

    expect(sec).toBe(100);
  });

  it("TC-UT_WLD-006 running でも running_since が null なら、確定分だけを返す", () => {
    const world = { state: "running", world_elapsed_sec: 100, running_since: null, heartbeat_at: null };

    const sec = getWorldTimeSec(world, at("2026-10-22T01:00:00.000Z"));

    expect(sec).toBe(100);
  });

  it("TC-UT_WLD-007 running_since から 999 ミリ秒は 0 秒、1,000 ミリ秒は 1 秒と数える", () => {
    const world = { state: "running", world_elapsed_sec: 0, running_since: SINCE, heartbeat_at: SINCE };

    const before = getWorldTimeSec(world, at("2026-10-22T00:00:00.999Z"));
    const just = getWorldTimeSec(world, at("2026-10-22T00:00:01.000Z"));

    expect(before).toBe(0);
    expect(just).toBe(1);
  });

  it("TC-UT_WLD-008 生存時刻からちょうど 180 秒なら補正せず、heartbeat_at だけを now にする", () => {
    const world = {
      state: "running",
      world_elapsed_sec: 100,
      running_since: SINCE,
      heartbeat_at: "2026-10-22T00:10:00.000Z",
    };
    const now = at("2026-10-22T00:13:00.000Z");

    const patch = heartbeatPatch(world, now);

    expect(patch).toEqual({ world_elapsed_sec: 100, running_since: SINCE, heartbeat_at: now.toISOString() });
  });

  it("TC-UT_WLD-009 生存時刻から 181 秒なら補正し、最後の生存時刻までを足して running_since を now にする", () => {
    const world = {
      state: "running",
      world_elapsed_sec: 100,
      running_since: SINCE,
      heartbeat_at: "2026-10-22T00:10:00.000Z",
    };
    const now = at("2026-10-22T00:13:01.000Z");

    const patch = heartbeatPatch(world, now);

    expect(patch).toEqual({
      world_elapsed_sec: 700,
      running_since: now.toISOString(),
      heartbeat_at: now.toISOString(),
    });
  });

  it("TC-UT_WLD-010 heartbeat_at が null なら running_since を最後の生存時刻として補正する", () => {
    const world = { state: "running", world_elapsed_sec: 100, running_since: SINCE, heartbeat_at: null };
    const now = at("2026-10-22T01:00:00.000Z");

    const patch = heartbeatPatch(world, now);

    expect(patch).toEqual({
      world_elapsed_sec: 100,
      running_since: now.toISOString(),
      heartbeat_at: now.toISOString(),
    });
  });

  it("TC-UT_WLD-011 起動時の補正で heartbeat_at が null なら、確定分は変えずに running_since と heartbeat_at を now にする", () => {
    const world = { state: "running", world_elapsed_sec: 42, running_since: SINCE, heartbeat_at: null };
    const now = at("2026-10-23T00:00:00.000Z");

    const patch = startupPatch(world, now);

    expect(patch).toEqual({ world_elapsed_sec: 42, running_since: now.toISOString(), heartbeat_at: now.toISOString() });
  });

  it("TC-UT_WLD-012 起動時の補正で heartbeat_at が running_since より前なら、足す秒は 0 にする", () => {
    const world = {
      state: "running",
      world_elapsed_sec: 42,
      running_since: SINCE,
      heartbeat_at: "2026-10-21T23:00:00.000Z",
    };
    const now = at("2026-10-23T00:00:00.000Z");

    const patch = startupPatch(world, now);

    expect(patch?.world_elapsed_sec).toBe(42);
  });
});

describe("settleWorldTime（単体テスト）", () => {
  let t: TestDb;
  const WORLD_ID = "01JWLD0000000000000000000A";

  beforeEach(() => {
    t = createTestDb();
    t.db
      .insert(worlds)
      .values({
        world_id: WORLD_ID,
        name: "世界 2026-10-22",
        state: "running",
        world_elapsed_sec: 100,
        running_since: SINCE,
        heartbeat_at: SINCE,
        started_at: SINCE,
        created_at: SINCE,
      })
      .run();
  });

  afterEach(() => {
    t.cleanup();
  });

  it("TC-UT_WLD-013 running の世界の世界内時間を確定し、遷移先の state と同じ UPDATE で書いて確定した秒を返す", () => {
    const world = t.db.select().from(worlds).where(eq(worlds.world_id, WORLD_ID)).get()!;

    const sec = withTx(t.db, (tx) =>
      settleWorldTime(tx, world, at("2026-10-22T00:01:30.000Z"), { state: "paused", stop_reason: "manual_pause" }),
    );

    const row = t.db.select().from(worlds).where(eq(worlds.world_id, WORLD_ID)).get()!;
    expect(sec).toBe(190);
    expect(row).toMatchObject({
      state: "paused",
      stop_reason: "manual_pause",
      world_elapsed_sec: 190,
      running_since: null,
    });
  });

  it("TC-UT_WLD-014 読んだときと state が違えば書かずに null を返す（楽観の確認）", () => {
    const stale = {
      ...t.db.select().from(worlds).where(eq(worlds.world_id, WORLD_ID)).get()!,
      state: "paused" as const,
    };

    const sec = withTx(t.db, (tx) =>
      settleWorldTime(tx, stale, at("2026-10-22T00:01:30.000Z"), {
        state: "emergency_stopped",
        stop_reason: "emergency",
      }),
    );

    const row = t.db.select().from(worlds).where(eq(worlds.world_id, WORLD_ID)).get()!;
    expect(sec).toBeNull();
    expect(row).toMatchObject({ state: "running", world_elapsed_sec: 100, running_since: SINCE });
  });
});
