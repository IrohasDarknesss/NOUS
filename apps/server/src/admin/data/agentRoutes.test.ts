import type { WorldState } from "@nous/shared";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TEST_NOW, seedAdmin, seedSession, testDeps } from "../../../test/helpers/adminTestSupport";
import { createTestDb, type TestDb } from "../../../test/helpers/testDb";
import { FakeClock } from "../../clock/fakeClock";
import { admin_audit_logs, agents, memories, worlds } from "../../db/schema";
import { withTx } from "../../db/tx";
import { newUlid } from "../../lib/ids";
import { createInitialWorld, type WorldRow } from "../../world/worldService";
import { createAdminApp } from "../adminServer";
import { CSRF_HEADER } from "../middleware/csrf";
import { ADMIN_COOKIE } from "../middleware/sessionAuth";

const VALID_BODY = {
  handle: "minato",
  displayName: "ミナト",
  bio: "海辺の街で暮らしています",
  interests: "写真と散歩",
  topics: "街の風景",
  personality: "穏やかで聞き上手",
  valuesText: "日々の小さな発見を大切にする",
  stance: "相手の話をまず受け止める",
  activityLevel: 3,
  noRealPersonConfirmed: true,
};

describe("agentRoutes (/admin/api/agents*)", () => {
  let t: TestDb;
  let clock: FakeClock;
  let cookie: string;
  let csrfToken: string;

  beforeEach(() => {
    t = createTestDb();
    clock = new FakeClock(TEST_NOW);
    seedAdmin(t.db, TEST_NOW);
    const s = seedSession(t.db, TEST_NOW);
    cookie = `${ADMIN_COOKIE}=${s.cookie}`;
    csrfToken = s.csrfToken;
  });

  afterEach(() => {
    t.cleanup();
  });

  function app() {
    return createAdminApp(testDeps(t.db, clock), { staticDir: null });
  }

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

  function authHeaders(withCsrf = false): Record<string, string> {
    return withCsrf
      ? { Cookie: cookie, [CSRF_HEADER]: csrfToken, "Content-Type": "application/json" }
      : { Cookie: cookie };
  }

  it("TC-NOUS64_DEV-15 GET /admin/api/agents は現在の世界のエージェント一覧と worldState を 200 で返し、state で絞り込める", async () => {
    const world = seedPreparingWorld();
    const a = app();

    const r1 = await a.request("/admin/api/agents", {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify(VALID_BODY),
    });
    const { agentId: id1 } = (await r1.json()) as { agentId: string };

    await clock.advance(1000);
    const r2 = await a.request("/admin/api/agents", {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify({ ...VALID_BODY, handle: "haruka", displayName: "ハルカ" }),
    });
    const { agentId: id2 } = (await r2.json()) as { agentId: string };

    setWorldState(world.world_id, "running");
    await a.request(`/admin/api/agents/${id2}/stop`, {
      method: "POST",
      headers: { Cookie: cookie, [CSRF_HEADER]: csrfToken },
    });

    const listAll = await a.request("/admin/api/agents", { headers: authHeaders() });
    expect(listAll.status).toBe(200);
    expect(await listAll.json()).toEqual({
      worldState: "running",
      items: [
        {
          agentId: id1,
          handle: "minato",
          displayName: "ミナト",
          state: "active",
          activityLevel: 3,
          postCount: 0,
          lastActionAt: null,
          lastAction: null,
        },
        {
          agentId: id2,
          handle: "haruka",
          displayName: "ハルカ",
          state: "stopped",
          activityLevel: 3,
          postCount: 0,
          lastActionAt: null,
          lastAction: null,
        },
      ],
    });

    const listStopped = await a.request("/admin/api/agents?state=stopped", { headers: authHeaders() });
    expect(listStopped.status).toBe(200);
    expect(await listStopped.json()).toMatchObject({
      worldState: "running",
      items: [{ agentId: id2, handle: "haruka", state: "stopped" }],
    });
  });

  it("TC-NOUS64_DEV-16 GET /admin/api/agents は state=bad に 400 VALIDATION_ERROR（{ error: { code, message, fields } }）を返す", async () => {
    seedPreparingWorld();
    const res = await app().request("/admin/api/agents?state=bad", { headers: authHeaders() });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: {
        code: "VALIDATION_ERROR",
        message: "入力の内容を確認してください",
        fields: { state: expect.any(String) },
      },
    });
  });

  it("TC-NOUS64_DEV-17 POST /admin/api/agents はエージェントを登録して 201 { agentId } を返し、interest_profile と監査ログを作る", async () => {
    const world = seedPreparingWorld();
    const res = await app().request("/admin/api/agents", {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify(VALID_BODY),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { agentId: string };
    expect(body.agentId).toHaveLength(26);

    const mem = t.db
      .select()
      .from(memories)
      .where(and(eq(memories.agent_id, body.agentId), eq(memories.kind, "interest_profile")))
      .get();
    expect(mem?.content).toBe("興味：写真と散歩。関心：街の風景。大事にしていること：日々の小さな発見を大切にする");

    const audit = t.db.select().from(admin_audit_logs).where(eq(admin_audit_logs.operation, "agent.create")).get();
    expect(audit).toMatchObject({
      target_type: "agent",
      target_id: body.agentId,
      world_id: world.world_id,
    });
  });

  it("TC-NOUS64_DEV-18 POST /admin/api/agents は検証失敗（handle 2字・noRealPersonConfirmed false）や非 JSON 本文で 400、重複で 409 HANDLE_TAKEN、準備中以外で 409 STATE_CONFLICT を返す", async () => {
    const world = seedPreparingWorld();
    const a = app();

    const invalid = await a.request("/admin/api/agents", {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify({ ...VALID_BODY, handle: "ab", noRealPersonConfirmed: false }),
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({
      error: {
        code: "VALIDATION_ERROR",
        message: "入力の内容を確認してください",
        fields: {
          handle: expect.any(String),
          noRealPersonConfirmed: expect.any(String),
        },
      },
    });

    const malformed = await a.request("/admin/api/agents", {
      method: "POST",
      headers: authHeaders(true),
      body: "{not-json",
    });
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({
      error: {
        code: "VALIDATION_ERROR",
        message: "入力の内容を確認してください",
        fields: {},
      },
    });

    const created = await a.request("/admin/api/agents", {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify(VALID_BODY),
    });
    expect(created.status).toBe(201);

    const dup = await a.request("/admin/api/agents", {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify(VALID_BODY),
    });
    expect(dup.status).toBe(409);
    expect(await dup.json()).toEqual({
      error: {
        code: "HANDLE_TAKEN",
        message: "このハンドルは使われています",
        fields: {},
      },
    });

    setWorldState(world.world_id, "running");
    const conflict = await a.request("/admin/api/agents", {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify({ ...VALID_BODY, handle: "new_agent" }),
    });
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({
      error: {
        code: "STATE_CONFLICT",
        message: "世界の状態が変わっています。最新の状態を読み直してください",
        fields: {},
      },
    });
  });

  it("TC-NOUS64_DEV-19 PUT /admin/api/agents/:agentId はエージェントを更新して 200 { agentId } を返し、interest_profile の作り直しと監査記録を行う", async () => {
    seedPreparingWorld();
    const a = app();

    const createRes = await a.request("/admin/api/agents", {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify(VALID_BODY),
    });
    const { agentId } = (await createRes.json()) as { agentId: string };

    const updateRes = await a.request(`/admin/api/agents/${agentId}`, {
      method: "PUT",
      headers: authHeaders(true),
      body: JSON.stringify({
        ...VALID_BODY,
        displayName: "ミナト更新",
        interests: "料理",
        topics: "季節の食材",
        valuesText: "丁寧な暮らし",
      }),
    });
    expect(updateRes.status).toBe(200);
    expect(await updateRes.json()).toEqual({ agentId });

    const mem = t.db
      .select()
      .from(memories)
      .where(and(eq(memories.agent_id, agentId), eq(memories.kind, "interest_profile")))
      .get();
    expect(mem?.content).toBe("興味：料理。関心：季節の食材。大事にしていること：丁寧な暮らし");

    const audit = t.db.select().from(admin_audit_logs).where(eq(admin_audit_logs.operation, "agent.update")).get();
    expect(audit?.target_id).toBe(agentId);
    expect(JSON.parse(audit!.before_json!)).toMatchObject({ displayName: "ミナト" });
    expect(JSON.parse(audit!.after_json!)).toMatchObject({ displayName: "ミナト更新" });
  });

  it("TC-NOUS64_DEV-20 PUT /admin/api/agents/:agentId は 26 字でない agentId に 400、不在に 404 AGENT_NOT_FOUND、重複に 409 HANDLE_TAKEN、準備中以外に 409 STATE_CONFLICT を返す", async () => {
    const world = seedPreparingWorld();
    const a = app();

    const r1 = await a.request("/admin/api/agents", {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify(VALID_BODY),
    });
    const { agentId: id1 } = (await r1.json()) as { agentId: string };

    await a.request("/admin/api/agents", {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify({ ...VALID_BODY, handle: "haruka" }),
    });

    // パスの agentId が 26 字でないときは 400 VALIDATION_ERROR
    const badId = await a.request("/admin/api/agents/short", {
      method: "PUT",
      headers: authHeaders(true),
      body: JSON.stringify(VALID_BODY),
    });
    expect(badId.status).toBe(400);
    expect(await badId.json()).toEqual({
      error: {
        code: "VALIDATION_ERROR",
        message: "入力の内容を確認してください",
        fields: { agentId: expect.any(String) },
      },
    });

    // 存在しないエージェントは 404 AGENT_NOT_FOUND
    const notFound = await a.request(`/admin/api/agents/${newUlid(clock.nowMs())}`, {
      method: "PUT",
      headers: authHeaders(true),
      body: JSON.stringify({ ...VALID_BODY, handle: "nobody" }),
    });
    expect(notFound.status).toBe(404);
    expect(await notFound.json()).toEqual({
      error: {
        code: "AGENT_NOT_FOUND",
        message: "この住人は見つかりません",
        fields: {},
      },
    });

    // 他エージェントの handle に変えようとすると 409 HANDLE_TAKEN
    const taken = await a.request(`/admin/api/agents/${id1}`, {
      method: "PUT",
      headers: authHeaders(true),
      body: JSON.stringify({ ...VALID_BODY, handle: "haruka" }),
    });
    expect(taken.status).toBe(409);
    expect(await taken.json()).toMatchObject({ error: { code: "HANDLE_TAKEN" } });

    // 準備中以外では 409 STATE_CONFLICT
    setWorldState(world.world_id, "running");
    const conflict = await a.request(`/admin/api/agents/${id1}`, {
      method: "PUT",
      headers: authHeaders(true),
      body: JSON.stringify(VALID_BODY),
    });
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ error: { code: "STATE_CONFLICT" } });
  });

  it("TC-NOUS64_DEV-21 DELETE /admin/api/agents/:agentId は memories と agents を削除して 204（本文なし）を返し、監査ログを残す", async () => {
    seedPreparingWorld();
    const a = app();

    const createRes = await a.request("/admin/api/agents", {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify(VALID_BODY),
    });
    const { agentId } = (await createRes.json()) as { agentId: string };

    const delRes = await a.request(`/admin/api/agents/${agentId}`, {
      method: "DELETE",
      headers: { Cookie: cookie, [CSRF_HEADER]: csrfToken },
    });
    expect(delRes.status).toBe(204);
    expect(await delRes.text()).toBe("");

    expect(t.db.select().from(agents).where(eq(agents.agent_id, agentId)).all()).toHaveLength(0);
    expect(t.db.select().from(memories).where(eq(memories.agent_id, agentId)).all()).toHaveLength(0);

    const audit = t.db.select().from(admin_audit_logs).where(eq(admin_audit_logs.operation, "agent.delete")).get();
    expect(audit?.target_id).toBe(agentId);
    expect(JSON.parse(audit!.before_json!)).toMatchObject({ handle: "minato" });
  });

  it("TC-NOUS64_DEV-22 DELETE /admin/api/agents/:agentId は不在で 404 AGENT_NOT_FOUND、準備中以外で 409 STATE_CONFLICT を返す", async () => {
    const world = seedPreparingWorld();
    const a = app();

    const createRes = await a.request("/admin/api/agents", {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify(VALID_BODY),
    });
    const { agentId } = (await createRes.json()) as { agentId: string };

    const notFound = await a.request(`/admin/api/agents/${newUlid(clock.nowMs())}`, {
      method: "DELETE",
      headers: { Cookie: cookie, [CSRF_HEADER]: csrfToken },
    });
    expect(notFound.status).toBe(404);
    expect(await notFound.json()).toMatchObject({ error: { code: "AGENT_NOT_FOUND" } });

    setWorldState(world.world_id, "paused");
    const conflict = await a.request(`/admin/api/agents/${agentId}`, {
      method: "DELETE",
      headers: { Cookie: cookie, [CSRF_HEADER]: csrfToken },
    });
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ error: { code: "STATE_CONFLICT" } });
  });

  it("TC-NOUS64_DEV-23 POST /admin/api/agents/:agentId/stop は 200 { agentId, state: 'stopped' }、準備中は 409 STATE_CONFLICT、停止済みは 409 ALREADY_STOPPED、不在は 404 AGENT_NOT_FOUND を返す", async () => {
    const world = seedPreparingWorld();
    const a = app();

    const createRes = await a.request("/admin/api/agents", {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify(VALID_BODY),
    });
    const { agentId } = (await createRes.json()) as { agentId: string };

    // 準備中は 409 STATE_CONFLICT
    const inPreparing = await a.request(`/admin/api/agents/${agentId}/stop`, {
      method: "POST",
      headers: { Cookie: cookie, [CSRF_HEADER]: csrfToken },
    });
    expect(inPreparing.status).toBe(409);
    expect(await inPreparing.json()).toEqual({
      error: {
        code: "STATE_CONFLICT",
        message: "世界の状態が変わっています。最新の状態を読み直してください",
        fields: {},
      },
    });

    setWorldState(world.world_id, "running");

    // 存在しない ID は 404 AGENT_NOT_FOUND
    const notFound = await a.request(`/admin/api/agents/${newUlid(clock.nowMs())}/stop`, {
      method: "POST",
      headers: { Cookie: cookie, [CSRF_HEADER]: csrfToken },
    });
    expect(notFound.status).toBe(404);
    expect(await notFound.json()).toMatchObject({ error: { code: "AGENT_NOT_FOUND" } });

    // 正常停止は 200
    const ok = await a.request(`/admin/api/agents/${agentId}/stop`, {
      method: "POST",
      headers: { Cookie: cookie, [CSRF_HEADER]: csrfToken },
    });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ agentId, state: "stopped" });

    // すでに stopped は 409 ALREADY_STOPPED
    const already = await a.request(`/admin/api/agents/${agentId}/stop`, {
      method: "POST",
      headers: { Cookie: cookie, [CSRF_HEADER]: csrfToken },
    });
    expect(already.status).toBe(409);
    expect(await already.json()).toEqual({
      error: {
        code: "ALREADY_STOPPED",
        message: "このエージェントはすでに停止しています",
        fields: {},
      },
    });
  });

  it("TC-NOUS64_DEV-24 POST /admin/api/agents/:agentId/resume は 200 { agentId, state: 'active' }、稼働中は 409 ALREADY_ACTIVE、不在は 404 AGENT_NOT_FOUND を返す", async () => {
    const world = seedPreparingWorld();
    const a = app();

    const createRes = await a.request("/admin/api/agents", {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify(VALID_BODY),
    });
    const { agentId } = (await createRes.json()) as { agentId: string };

    setWorldState(world.world_id, "running");
    await a.request(`/admin/api/agents/${agentId}/stop`, {
      method: "POST",
      headers: { Cookie: cookie, [CSRF_HEADER]: csrfToken },
    });

    // 存在しない ID は 404 AGENT_NOT_FOUND
    const notFound = await a.request(`/admin/api/agents/${newUlid(clock.nowMs())}/resume`, {
      method: "POST",
      headers: { Cookie: cookie, [CSRF_HEADER]: csrfToken },
    });
    expect(notFound.status).toBe(404);
    expect(await notFound.json()).toMatchObject({ error: { code: "AGENT_NOT_FOUND" } });

    // 正常再開は 200
    const ok = await a.request(`/admin/api/agents/${agentId}/resume`, {
      method: "POST",
      headers: { Cookie: cookie, [CSRF_HEADER]: csrfToken },
    });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ agentId, state: "active" });

    // すでに active は 409 ALREADY_ACTIVE
    const already = await a.request(`/admin/api/agents/${agentId}/resume`, {
      method: "POST",
      headers: { Cookie: cookie, [CSRF_HEADER]: csrfToken },
    });
    expect(already.status).toBe(409);
    expect(await already.json()).toEqual({
      error: {
        code: "ALREADY_ACTIVE",
        message: "このエージェントはすでに稼働しています",
        fields: {},
      },
    });
  });

  it("TC-NOUS64_DEV-25 X-CSRF-Token のない POST は adminServer のガードにより 403 CSRF_INVALID になる", async () => {
    seedPreparingWorld();
    const res = await app().request("/admin/api/agents", {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify(VALID_BODY),
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: {
        code: "CSRF_INVALID",
        message: "画面を再読み込みしてから、もう一度操作してください",
        fields: {},
      },
    });
  });
});
