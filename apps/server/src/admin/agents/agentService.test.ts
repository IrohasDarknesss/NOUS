import type { WorldState } from "@nous/shared";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TEST_ADMIN_ID, TEST_NOW, seedAdmin } from "../../../test/helpers/adminTestSupport";
import { createTestDb, type TestDb } from "../../../test/helpers/testDb";
import { FakeClock } from "../../clock/fakeClock";
import { admin_audit_logs, agents, generation_events, memories, posts, worlds } from "../../db/schema";
import { withTx } from "../../db/tx";
import { AppError } from "../../lib/errors";
import { newUlid } from "../../lib/ids";
import { createInitialWorld, findCurrentWorld, type WorldRow } from "../../world/worldService";
import {
  assertPreparing,
  buildInterestProfile,
  createAgent,
  deleteAgent,
  guardUniqueHandle,
  listAgents,
  resumeAgent,
  stopAgent,
  updateAgentProfile,
} from "./agentService";

const ADMIN = { adminId: TEST_ADMIN_ID };

const BASE_INPUT = {
  handle: "minato",
  displayName: "ミナト",
  bio: "海辺の街が好きです",
  interests: "写真と散歩",
  topics: "街の風景",
  personality: "穏やかで聞き上手",
  valuesText: "日々の小さな発見を大切にする",
  stance: "相手の話をまず受け止める",
  activityLevel: 3,
  noRealPersonConfirmed: true as const,
};

function expectAppError(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe(code);
    return;
  }
  throw new Error(`${code} が投げられませんでした`);
}

describe("agentService", () => {
  let t: TestDb;
  let clock: FakeClock;

  beforeEach(() => {
    t = createTestDb();
    clock = new FakeClock(TEST_NOW);
    seedAdmin(t.db, TEST_NOW);
  });

  afterEach(() => {
    t.cleanup();
  });

  function seedPreparingWorld(): WorldRow {
    return withTx(t.db, (tx) => createInitialWorld(tx, clock.now()));
  }

  function setWorldState(worldId: string, state: WorldState): void {
    const iso = clock.nowIso();
    t.db
      .update(worlds)
      .set({
        state,
        running_since: state === "running" ? iso : null,
        archived_at: state === "archived" ? iso : null,
        stop_reason:
          state === "paused"
            ? "manual_pause"
            : state === "limit_stopped"
              ? "neurons_limit"
              : state === "emergency_stopped"
                ? "emergency"
                : null,
      })
      .where(eq(worlds.world_id, worldId))
      .run();
  }

  function seedGenerationEvent(
    worldId: string,
    agentId: string,
    options: {
      startedAt?: string;
      action?: "post" | "reply" | "like" | "follow" | "unfollow" | "none" | null;
      status?: "running" | "succeeded" | "failed" | "cancelled" | "interrupted";
    } = {},
  ): string {
    const eventId = newUlid(clock.nowMs());
    const startedAt = options.startedAt ?? clock.nowIso();
    const status = options.status ?? "succeeded";
    t.db
      .insert(generation_events)
      .values({
        event_id: eventId,
        world_id: worldId,
        agent_id: agentId,
        cycle_no: 1,
        cycle_seed: 42,
        status,
        decided_by: "llm",
        action: options.action === undefined ? "post" : options.action,
        model_id: "@cf/google/gemma-4-26b-a4b-it",
        prompt_version: "v1",
        llm_mode: "fixed",
        world_time_sec: 10,
        started_at: startedAt,
        finished_at: status === "running" ? null : startedAt,
        usage_date: startedAt.slice(0, 10),
      })
      .run();
    return eventId;
  }

  function seedPost(worldId: string, agentId: string, eventId: string, body = "テスト投稿"): string {
    const postId = newUlid(clock.nowMs());
    t.db
      .insert(posts)
      .values({
        post_id: postId,
        world_id: worldId,
        agent_id: agentId,
        body,
        reply_to_post_id: null,
        root_post_id: postId,
        depth: 0,
        visibility: "public",
        world_time_sec: 10,
        created_at: clock.nowIso(),
        generation_event_id: eventId,
      })
      .run();
    return postId;
  }

  it("TC-NOUS64_DEV-01 assertPreparing は preparing の世界だけを通し、それ以外は STATE_CONFLICT を投げる", () => {
    const world = seedPreparingWorld();
    expect(() => assertPreparing(t.db, world)).not.toThrow();
    expectAppError(() => assertPreparing(t.db, undefined), "STATE_CONFLICT");

    for (const state of ["running", "paused", "limit_stopped", "emergency_stopped", "archived"] as const) {
      expectAppError(() => assertPreparing(t.db, { ...world, state }), "STATE_CONFLICT");
    }
  });

  it("TC-NOUS64_DEV-02 buildInterestProfile は 200 字までの1文を組み立て、memories の interest_profile に upsert する", () => {
    seedPreparingWorld();
    const { agentId } = createAgent(t.db, clock, BASE_INPUT, ADMIN);

    const shortText = withTx(t.db, (tx) =>
      buildInterestProfile(tx, agentId, { interests: "読書", topics: "歴史", valuesText: "探究心" }, clock.nowIso()),
    );
    expect(shortText).toBe("興味：読書。関心：歴史。大事にしていること：探究心");

    const mem1 = t.db
      .select()
      .from(memories)
      .where(and(eq(memories.agent_id, agentId), eq(memories.kind, "interest_profile")))
      .get();
    expect(mem1?.content).toBe(shortText);

    const longInput = {
      interests: "あ".repeat(100),
      topics: "い".repeat(100),
      valuesText: "う".repeat(100),
    };
    const clipped = withTx(t.db, (tx) => buildInterestProfile(tx, agentId, longInput, clock.nowIso()));
    expect(clipped.length).toBe(200);
    expect(clipped.startsWith("興味：あああ")).toBe(true);

    const rows = t.db
      .select()
      .from(memories)
      .where(and(eq(memories.agent_id, agentId), eq(memories.kind, "interest_profile")))
      .all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.content).toBe(clipped);
  });

  it("TC-NOUS64_DEV-03 listAgents は created_at の順で postCount・lastActionAt・lastAction・worldState を返す", async () => {
    const world = seedPreparingWorld();
    const { agentId: firstId } = createAgent(t.db, clock, BASE_INPUT, ADMIN);
    await clock.advance(1000);
    const { agentId: secondId } = createAgent(
      t.db,
      clock,
      { ...BASE_INPUT, handle: "haruka", displayName: "ハルカ", activityLevel: 5 },
      ADMIN,
    );

    const ev1 = seedGenerationEvent(world.world_id, firstId, {
      startedAt: "2026-10-20T01:00:00.000Z",
      action: "post",
    });
    seedPost(world.world_id, firstId, ev1, "1つ目の投稿");
    const ev2 = seedGenerationEvent(world.world_id, firstId, {
      startedAt: "2026-10-20T02:00:00.000Z",
      action: "reply",
    });
    seedPost(world.world_id, firstId, ev2, "2つ目の投稿");
    seedGenerationEvent(world.world_id, firstId, {
      startedAt: "2026-10-20T03:00:00.000Z",
      action: "like",
    });

    const res = listAgents(t.db);
    expect(res.worldState).toBe("preparing");
    expect(res.items).toEqual([
      {
        agentId: firstId,
        handle: "minato",
        displayName: "ミナト",
        state: "active",
        activityLevel: 3,
        postCount: 2,
        lastActionAt: "2026-10-20T03:00:00.000Z",
        lastAction: "like",
      },
      {
        agentId: secondId,
        handle: "haruka",
        displayName: "ハルカ",
        state: "active",
        activityLevel: 5,
        postCount: 0,
        lastActionAt: null,
        lastAction: null,
      },
    ]);
  });

  it("TC-NOUS64_DEV-04 listAgents は state で絞り込め、アーカイブの世界のエージェントを含めず、不正な state は 400 VALIDATION_ERROR にする", () => {
    const oldWorld = seedPreparingWorld();
    createAgent(t.db, clock, { ...BASE_INPUT, handle: "old_agent" }, ADMIN);
    setWorldState(oldWorld.world_id, "archived");

    const world = seedPreparingWorld();
    const { agentId: activeId } = createAgent(t.db, clock, BASE_INPUT, ADMIN);
    const { agentId: stoppedId } = createAgent(
      t.db,
      clock,
      { ...BASE_INPUT, handle: "zen", displayName: "ゼン" },
      ADMIN,
    );
    setWorldState(world.world_id, "running");
    stopAgent(t.db, clock, stoppedId, ADMIN);

    const activeOnly = listAgents(t.db, { state: "active" });
    expect(activeOnly.worldState).toBe("running");
    expect(activeOnly.items.map((i) => i.agentId)).toEqual([activeId]);

    const stoppedOnly = listAgents(t.db, { state: "stopped" });
    expect(stoppedOnly.items.map((i) => i.agentId)).toEqual([stoppedId]);

    expectAppError(() => listAgents(t.db, { state: "invalid" as never }), "VALIDATION_ERROR");
  });

  it("TC-NOUS64_DEV-05 createAgent はエージェント登録・interest_profile 作成・監査記録を1トランザクションで行う", () => {
    const world = seedPreparingWorld();
    const { agentId } = createAgent(t.db, clock, BASE_INPUT, ADMIN);

    const agent = t.db.select().from(agents).where(eq(agents.agent_id, agentId)).get();
    expect(agent).toMatchObject({
      agent_id: agentId,
      world_id: world.world_id,
      handle: "minato",
      display_name: "ミナト",
      bio: "海辺の街が好きです",
      interests: "写真と散歩",
      topics: "街の風景",
      personality: "穏やかで聞き上手",
      values_text: "日々の小さな発見を大切にする",
      stance: "相手の話をまず受け止める",
      activity_level: 3,
      state: "active",
      created_at: TEST_NOW.toISOString(),
      updated_at: TEST_NOW.toISOString(),
    });

    const mem = t.db
      .select()
      .from(memories)
      .where(and(eq(memories.agent_id, agentId), eq(memories.kind, "interest_profile")))
      .get();
    expect(mem?.content).toBe("興味：写真と散歩。関心：街の風景。大事にしていること：日々の小さな発見を大切にする");

    const audit = t.db.select().from(admin_audit_logs).get();
    expect(audit).toMatchObject({
      admin_id: TEST_ADMIN_ID,
      operation: "agent.create",
      target_type: "agent",
      target_id: agentId,
      before_json: null,
      world_id: world.world_id,
      operated_at: TEST_NOW.toISOString(),
    });
    expect(JSON.parse(audit!.after_json!)).toMatchObject({
      handle: "minato",
      displayName: "ミナト",
      activityLevel: 3,
      state: "active",
    });
  });

  it("TC-NOUS64_DEV-06 createAgent は同じ世界の重複 handle と UNIQUE 違反を 409 HANDLE_TAKEN にし、別世界の同じ handle は許す", () => {
    const oldWorld = seedPreparingWorld();
    createAgent(t.db, clock, BASE_INPUT, ADMIN);
    setWorldState(oldWorld.world_id, "archived");

    seedPreparingWorld();
    // アーカイブ済みの旧世界と同じ handle は新しい世界では登録できる
    createAgent(t.db, clock, BASE_INPUT, ADMIN);

    // 同じ世界での重複は HANDLE_TAKEN
    expectAppError(() => createAgent(t.db, clock, BASE_INPUT, ADMIN), "HANDLE_TAKEN");

    // SQLite の UNIQUE 違反を直接捕捉した場合も HANDLE_TAKEN に変換される
    const sqliteErr = Object.assign(new Error("UNIQUE constraint failed: agents.world_id, agents.handle"), {
      name: "SqliteError",
      code: "SQLITE_CONSTRAINT_UNIQUE",
    });
    expectAppError(
      () =>
        guardUniqueHandle(() => {
          throw sqliteErr;
        }),
      "HANDLE_TAKEN",
    );
  });

  it("TC-NOUS64_DEV-07 createAgent は preparing 以外の世界では 409 STATE_CONFLICT で拒否し、行を増やさない", () => {
    const world = seedPreparingWorld();
    for (const state of ["running", "paused", "limit_stopped", "emergency_stopped"] as const) {
      setWorldState(world.world_id, state);
      expectAppError(() => createAgent(t.db, clock, BASE_INPUT, ADMIN), "STATE_CONFLICT");
    }
    expect(t.db.select().from(agents).all()).toHaveLength(0);
    expect(t.db.select().from(admin_audit_logs).all()).toHaveLength(0);
  });

  it("TC-NOUS64_DEV-08 updateAgentProfile は属性の更新・interest_profile の作り直し・agent.update の監査記録を行う", async () => {
    const world = seedPreparingWorld();
    const { agentId } = createAgent(t.db, clock, BASE_INPUT, ADMIN);
    await clock.advance(5000);

    const updatedInput = {
      ...BASE_INPUT,
      handle: "minato_v2",
      displayName: "ミナト改",
      bio: "新しい自己紹介",
      interests: "天体観測",
      topics: "星座と神話",
      personality: "落ち着いている",
      valuesText: "静かな時間を楽しむ",
      stance: "丁寧に対話する",
      activityLevel: 4,
    };
    const res = updateAgentProfile(t.db, clock, agentId, updatedInput, ADMIN);
    expect(res).toEqual({ agentId });

    const row = t.db.select().from(agents).where(eq(agents.agent_id, agentId)).get();
    expect(row).toMatchObject({
      handle: "minato_v2",
      display_name: "ミナト改",
      bio: "新しい自己紹介",
      interests: "天体観測",
      topics: "星座と神話",
      values_text: "静かな時間を楽しむ",
      activity_level: 4,
      updated_at: clock.nowIso(),
    });

    const mem = t.db
      .select()
      .from(memories)
      .where(and(eq(memories.agent_id, agentId), eq(memories.kind, "interest_profile")))
      .get();
    expect(mem?.content).toBe("興味：天体観測。関心：星座と神話。大事にしていること：静かな時間を楽しむ");

    // 自分自身の同じ handle のまま再更新しても HANDLE_TAKEN にならない
    expect(updateAgentProfile(t.db, clock, agentId, updatedInput, ADMIN)).toEqual({ agentId });

    const audits = t.db.select().from(admin_audit_logs).where(eq(admin_audit_logs.operation, "agent.update")).all();
    expect(audits).toHaveLength(2);
    expect(audits[0]?.world_id).toBe(world.world_id);
    expect(JSON.parse(audits[0]!.before_json!)).toMatchObject({ handle: "minato", displayName: "ミナト" });
    expect(JSON.parse(audits[0]!.after_json!)).toMatchObject({ handle: "minato_v2", displayName: "ミナト改" });
  });

  it("TC-NOUS64_DEV-09 updateAgentProfile は AGENT_NOT_FOUND・HANDLE_TAKEN・STATE_CONFLICT を適切に投げる", () => {
    const world = seedPreparingWorld();
    const { agentId: a1 } = createAgent(t.db, clock, BASE_INPUT, ADMIN);
    createAgent(t.db, clock, { ...BASE_INPUT, handle: "haruka" }, ADMIN);

    // 存在しない ID は 404 AGENT_NOT_FOUND
    expectAppError(() => updateAgentProfile(t.db, clock, newUlid(clock.nowMs()), BASE_INPUT, ADMIN), "AGENT_NOT_FOUND");

    // 他エージェントの handle への変更は 409 HANDLE_TAKEN
    expectAppError(
      () => updateAgentProfile(t.db, clock, a1, { ...BASE_INPUT, handle: "haruka" }, ADMIN),
      "HANDLE_TAKEN",
    );

    // preparing 以外では 409 STATE_CONFLICT
    setWorldState(world.world_id, "running");
    expectAppError(
      () => updateAgentProfile(t.db, clock, a1, { ...BASE_INPUT, displayName: "変更不可" }, ADMIN),
      "STATE_CONFLICT",
    );
  });

  it("TC-NOUS64_DEV-10 deleteAgent はエージェントと全種類の memories を削除し、agent.delete の監査を残す", () => {
    const world = seedPreparingWorld();
    const { agentId } = createAgent(t.db, clock, BASE_INPUT, ADMIN);
    // interest_profile 以外の記憶も入れて両方消えることを確かめる
    t.db
      .insert(memories)
      .values({
        memory_id: newUlid(clock.nowMs()),
        agent_id: agentId,
        kind: "recent_posts",
        content: "最近の行動",
        updated_at: clock.nowIso(),
      })
      .run();

    deleteAgent(t.db, clock, agentId, ADMIN);

    expect(t.db.select().from(agents).where(eq(agents.agent_id, agentId)).all()).toHaveLength(0);
    expect(t.db.select().from(memories).where(eq(memories.agent_id, agentId)).all()).toHaveLength(0);

    const audit = t.db.select().from(admin_audit_logs).where(eq(admin_audit_logs.operation, "agent.delete")).get();
    expect(audit).toMatchObject({
      admin_id: TEST_ADMIN_ID,
      target_type: "agent",
      target_id: agentId,
      after_json: null,
      world_id: world.world_id,
    });
    expect(JSON.parse(audit!.before_json!)).toMatchObject({ handle: "minato", displayName: "ミナト" });
  });

  it("TC-NOUS64_DEV-11 deleteAgent は存在しない ID に AGENT_NOT_FOUND、preparing 以外に STATE_CONFLICT を投げる", () => {
    const world = seedPreparingWorld();
    const { agentId } = createAgent(t.db, clock, BASE_INPUT, ADMIN);

    expectAppError(() => deleteAgent(t.db, clock, newUlid(clock.nowMs()), ADMIN), "AGENT_NOT_FOUND");

    setWorldState(world.world_id, "paused");
    expectAppError(() => deleteAgent(t.db, clock, agentId, ADMIN), "STATE_CONFLICT");
    expect(t.db.select().from(agents).where(eq(agents.agent_id, agentId)).all()).toHaveLength(1);
  });

  it("TC-NOUS64_DEV-12 stopAgent は稼働した世界のエージェントを stopped にし、agent.stop の監査を残す", () => {
    const world = seedPreparingWorld();
    const { agentId } = createAgent(t.db, clock, BASE_INPUT, ADMIN);
    setWorldState(world.world_id, "running");

    const res = stopAgent(t.db, clock, agentId, ADMIN);
    expect(res).toEqual({ agentId, state: "stopped" });

    const row = t.db.select().from(agents).where(eq(agents.agent_id, agentId)).get();
    expect(row?.state).toBe("stopped");

    const audit = t.db.select().from(admin_audit_logs).where(eq(admin_audit_logs.operation, "agent.stop")).get();
    expect(audit).toMatchObject({
      admin_id: TEST_ADMIN_ID,
      target_type: "agent",
      target_id: agentId,
      before_json: '{"state":"active"}',
      after_json: '{"state":"stopped"}',
      world_id: world.world_id,
    });
  });

  it("TC-NOUS64_DEV-13 stopAgent は preparing・archived で STATE_CONFLICT、不在で AGENT_NOT_FOUND、停止済みで ALREADY_STOPPED を投げる", () => {
    const world = seedPreparingWorld();
    const { agentId } = createAgent(t.db, clock, BASE_INPUT, ADMIN);

    // preparing の世界では STATE_CONFLICT
    expectAppError(() => stopAgent(t.db, clock, agentId, ADMIN), "STATE_CONFLICT");

    setWorldState(world.world_id, "paused");
    expectAppError(() => stopAgent(t.db, clock, newUlid(clock.nowMs()), ADMIN), "AGENT_NOT_FOUND");

    stopAgent(t.db, clock, agentId, ADMIN);
    expectAppError(() => stopAgent(t.db, clock, agentId, ADMIN), "ALREADY_STOPPED");

    // archived の世界（現在の世界がない状態）でも STATE_CONFLICT
    setWorldState(world.world_id, "archived");
    expect(findCurrentWorld(t.db)).toBeUndefined();
    expectAppError(() => stopAgent(t.db, clock, agentId, ADMIN), "STATE_CONFLICT");
  });

  it("TC-NOUS64_DEV-14 resumeAgent は stopped を active に戻して agent.resume の監査を残し、不在は AGENT_NOT_FOUND、稼働中は ALREADY_ACTIVE を投げる", () => {
    const world = seedPreparingWorld();
    const { agentId } = createAgent(t.db, clock, BASE_INPUT, ADMIN);
    setWorldState(world.world_id, "running");
    stopAgent(t.db, clock, agentId, ADMIN);

    const res = resumeAgent(t.db, clock, agentId, ADMIN);
    expect(res).toEqual({ agentId, state: "active" });

    const row = t.db.select().from(agents).where(eq(agents.agent_id, agentId)).get();
    expect(row?.state).toBe("active");

    const audit = t.db.select().from(admin_audit_logs).where(eq(admin_audit_logs.operation, "agent.resume")).get();
    expect(audit).toMatchObject({
      admin_id: TEST_ADMIN_ID,
      target_type: "agent",
      target_id: agentId,
      before_json: '{"state":"stopped"}',
      after_json: '{"state":"active"}',
      world_id: world.world_id,
    });

    expectAppError(() => resumeAgent(t.db, clock, agentId, ADMIN), "ALREADY_ACTIVE");
    expectAppError(() => resumeAgent(t.db, clock, newUlid(clock.nowMs()), ADMIN), "AGENT_NOT_FOUND");
  });
});
