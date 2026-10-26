// 単体テスト（NOUS-97）。観点表は docs/test/unit/NOUS-97/観点表_settings.json
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_SETTINGS, MODEL_OPTIONS, SETTINGS_RANGES } from "@nous/shared";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureLogger, seedAdmin, seedSession } from "../../test/helpers/adminTestSupport";
import { createTestDb, type TestDb } from "../../test/helpers/testDb";
import { createAdminApp } from "../admin/adminServer";
import { CSRF_HEADER } from "../admin/middleware/csrf";
import { ADMIN_COOKIE } from "../admin/middleware/sessionAuth";
import { FakeClock } from "../clock/fakeClock";
import type { GenerationConfig } from "../config/generationConfig";
import { agents, world_settings } from "../db/schema";
import { withTx } from "../db/tx";
import { newUlid } from "../lib/ids";
import { configureWorldApi, resetWorldApi } from "./worldRoutes";
import { createInitialWorld, type SchedulerControl, type WorldRow } from "./worldService";

const START = new Date("2026-10-22T00:00:00.000Z");

const CONFIG: GenerationConfig = {
  participation: { "1": 1, "2": 1, "3": 1, "4": 1, "5": 1 },
  candidateCount: 2,
  weights: { post: 3.0, reply: 3.0, like: 2.5, follow: 1.5, unfollow: 0.5 },
  recentPenalty: 0.4,
  firstPersonRules: [],
};

let t: TestDb;
let clock: FakeClock;
let session: { cookie: string; csrfToken: string; sessionHash: string };
let scheduler: SchedulerControl;
let promptsDir: string;

function app() {
  return createAdminApp({ db: t.db, clock, logger: captureLogger().logger }, { staticDir: null });
}

function put(body: unknown) {
  return app().request("/admin/api/settings", {
    method: "PUT",
    headers: {
      Cookie: `${ADMIN_COOKIE}=${session.cookie}`,
      [CSRF_HEADER]: session.csrfToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function seedWorld(): WorldRow {
  return withTx(t.db, (tx) => createInitialWorld(tx, clock.now()));
}

function settingsRow(worldId: string) {
  return t.db.select().from(world_settings).where(eq(world_settings.world_id, worldId)).get()!;
}

beforeEach(() => {
  t = createTestDb();
  clock = new FakeClock(START);
  seedAdmin(t.db, START);
  session = seedSession(t.db, START);
  scheduler = { stopAll: vi.fn(async () => 0), wake: vi.fn() };
  promptsDir = mkdtempSync(join(tmpdir(), "nous-ut-prompts-"));
  for (const v of ["v1", "v2"]) {
    mkdirSync(join(promptsDir, v));
    writeFileSync(join(promptsDir, v, "system.md"), "system");
    writeFileSync(join(promptsDir, v, "user.md"), "user");
  }
  configureWorldApi({ scheduler, generationConfig: CONFIG, promptsDir });
});

afterEach(() => {
  resetWorldApi();
  rmSync(promptsDir, { recursive: true, force: true });
  t.cleanup();
});

const OUT_OF_RANGE = Object.entries(SETTINGS_RANGES).flatMap(([key, range]) => [
  [key, range.min - 1],
  [key, range.max + 1],
]) as Array<[string, number]>;

describe("settingsRoutes（単体テスト）", () => {
  it.each(OUT_OF_RANGE)(
    "TC-UT_WLD-061 数値の項目が下限-1・上限+1 なら 400 VALIDATION_ERROR（fields にその項目）で、設定を変えない（%j）",
    async (key, value) => {
      const world = seedWorld();
      const before = settingsRow(world.world_id);

      const res = await put({ ...DEFAULT_SETTINGS, [key]: value });

      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        error: { code: "VALIDATION_ERROR", fields: { [key]: expect.any(String) } },
      });
      expect(settingsRow(world.world_id)).toEqual(before);
    },
  );

  it("TC-UT_WLD-062 modelId が選択肢の2値以外なら 400 VALIDATION_ERROR（fields.modelId）", async () => {
    seedWorld();

    const res = await put({ ...DEFAULT_SETTINGS, modelId: "@cf/meta/llama-3-8b-instruct" });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR", fields: { modelId: expect.any(String) } },
    });
  });

  it("TC-UT_WLD-063 必須の項目が欠けていれば 400 VALIDATION_ERROR（fields にその項目）", async () => {
    seedWorld();
    const body: Record<string, unknown> = { ...DEFAULT_SETTINGS };
    delete body.maxConcurrency;

    const res = await put(body);

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR", fields: { maxConcurrency: expect.any(String) } },
    });
  });

  it("TC-UT_WLD-064 GET /settings はモデルの2値と、設定した prompts の版の一覧を返し、その版を PUT で保存できる", async () => {
    const world = seedWorld();

    const res = await app().request("/admin/api/settings", {
      headers: { Cookie: `${ADMIN_COOKIE}=${session.cookie}` },
    });
    const saved = await put({ ...DEFAULT_SETTINGS, promptVersion: "v2" });

    expect(await res.json()).toMatchObject({ modelOptions: [...MODEL_OPTIONS], promptVersions: ["v1", "v2"] });
    expect(saved.status).toBe(200);
    expect(settingsRow(world.world_id).prompt_version).toBe("v2");
  });

  it("TC-UT_WLD-065 configureWorldApi で渡した generation の設定（参加の確率）で見込みを計算する", async () => {
    const world = seedWorld();
    const iso = clock.nowIso();
    t.db
      .insert(agents)
      .values({
        agent_id: newUlid(),
        world_id: world.world_id,
        handle: "alice",
        display_name: "alice",
        interests: "星",
        topics: "宇宙",
        personality: "穏やか",
        values_text: "誠実",
        stance: "中立",
        activity_level: 3,
        state: "active",
        created_at: iso,
        updated_at: iso,
      })
      .run();

    const res = await app().request("/admin/api/settings", {
      headers: { Cookie: `${ADMIN_COOKIE}=${session.cookie}` },
    });

    expect(await res.json()).toMatchObject({ activeAgents: 1, avgParticipation: 1, estimatedDailyRuns: 72 });
  });
});
