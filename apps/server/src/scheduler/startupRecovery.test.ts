import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { captureLogger, seedAdmin, seedSession } from "../../test/helpers/adminTestSupport";
import { createTestDb, type TestDb } from "../../test/helpers/testDb";
import { FakeClock } from "../clock/fakeClock";
import { admin_sessions, agents, generation_events, worlds } from "../db/schema";
import { withTx } from "../db/tx";
import { newUlid } from "../lib/ids";
import { createInitialWorld, findCurrentWorld } from "../world/worldService";
import { recoverOnStartup } from "./startupRecovery";

const NOW = new Date("2026-10-22T05:00:00.000Z");

let t: TestDb;
let clock: FakeClock;

beforeEach(() => {
  t = createTestDb();
  clock = new FakeClock(NOW);
});

afterEach(() => {
  t.cleanup();
});

function seedAgent(worldId: string): string {
  const agentId = newUlid();
  const iso = "2026-10-22T00:00:00.000Z";
  t.db
    .insert(agents)
    .values({
      agent_id: agentId,
      world_id: worldId,
      handle: "alice",
      display_name: "Alice",
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
  return agentId;
}

describe("startupRecovery", () => {
  it("TC-NOUS60_DEV-11 running の generation_events が interrupted になり、他の状態は変わらない", () => {
    const world = withTx(t.db, (tx) => createInitialWorld(tx, NOW));
    const agentId = seedAgent(world.world_id);
    const runningId = newUlid();
    const succeededId = newUlid();
    const startedIso = "2026-10-22T04:50:00.000Z";

    t.db
      .insert(generation_events)
      .values({
        event_id: runningId,
        world_id: world.world_id,
        agent_id: agentId,
        cycle_no: 1,
        cycle_seed: 1,
        status: "running",
        decided_by: "llm",
        model_id: "@cf/google/gemma-4-26b-a4b-it",
        prompt_version: "v1",
        llm_mode: "fixed",
        world_time_sec: 100,
        started_at: startedIso,
        usage_date: "2026-10-22",
      })
      .run();

    t.db
      .insert(generation_events)
      .values({
        event_id: succeededId,
        world_id: world.world_id,
        agent_id: agentId,
        cycle_no: 1,
        cycle_seed: 1,
        status: "succeeded",
        decided_by: "llm",
        action: "none",
        model_id: "@cf/google/gemma-4-26b-a4b-it",
        prompt_version: "v1",
        llm_mode: "fixed",
        world_time_sec: 100,
        started_at: startedIso,
        finished_at: "2026-10-22T04:50:05.000Z",
        usage_date: "2026-10-22",
      })
      .run();

    const { logger } = captureLogger();
    const res = recoverOnStartup({ db: t.db, clock, logger }, NOW);

    expect(res.closedEvents).toBe(1);
    const closedRow = t.db.select().from(generation_events).where(eq(generation_events.event_id, runningId)).get()!;
    expect(closedRow.status).toBe("interrupted");
    expect(closedRow.failure_kind).toBe("interrupted");
    expect(closedRow.finished_at).toBe(NOW.toISOString());

    const succeededRow = t.db
      .select()
      .from(generation_events)
      .where(eq(generation_events.event_id, succeededId))
      .get()!;
    expect(succeededRow.status).toBe("succeeded");
  });

  it("TC-NOUS60_DEV-12 running の世界の世界内時間が heartbeat_at までで補正され、running_since と heartbeat_at が now になる", () => {
    const world = withTx(t.db, (tx) => createInitialWorld(tx, NOW));
    // 00:00 から 00:10（600 秒）まで動いてからプロセスが落ち、05:00 に再起動した想定
    t.db
      .update(worlds)
      .set({
        state: "running",
        world_elapsed_sec: 120,
        running_since: "2026-10-22T00:00:00.000Z",
        heartbeat_at: "2026-10-22T00:10:00.000Z",
      })
      .where(eq(worlds.world_id, world.world_id))
      .run();

    const { logger } = captureLogger();
    const res = recoverOnStartup({ db: t.db, clock, logger }, NOW);

    expect(res.worldPatched).toBe(true);
    const updated = findCurrentWorld(t.db)!;
    expect(updated.state).toBe("running");
    expect(updated.world_elapsed_sec).toBe(720);
    expect(updated.running_since).toBe(NOW.toISOString());
    expect(updated.heartbeat_at).toBe(NOW.toISOString());
  });

  it("TC-NOUS60_DEV-13 期限切れのセッションだけが削除される", () => {
    seedAdmin(t.db, NOW);
    // 有効なセッション（10 分前に作成・最終操作）
    const active = seedSession(
      t.db,
      new Date(NOW.getTime() - 10 * 60 * 1000),
      new Date(NOW.getTime() - 10 * 60 * 1000),
    );
    // アイドル期限切れ（90 分前に最終操作）
    seedSession(t.db, new Date(NOW.getTime() - 90 * 60 * 1000), new Date(NOW.getTime() - 90 * 60 * 1000));

    const { logger, lines } = captureLogger();
    const res = recoverOnStartup({ db: t.db, clock, logger }, NOW);

    expect(res.deletedSessions).toBe(1);
    const remaining = t.db.select().from(admin_sessions).all();
    expect(remaining.map((r) => r.session_hash)).toEqual([active.sessionHash]);
    expect(lines().some((l) => l.level === "info")).toBe(true);
  });
});
