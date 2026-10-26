// 単体テスト（NOUS-91）。観点表は docs/test/unit/NOUS-91/観点表_auth.json
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TEST_ADMIN_ID, TEST_NOW, testDeps } from "../../../test/helpers/adminTestSupport";
import { createTestDb, type TestDb } from "../../../test/helpers/testDb";
import { admin_account } from "../../db/schema";
import { createAdminApp } from "../adminServer";
import { CSRF_HEADER } from "../middleware/csrf";
import { ADMIN_COOKIE, SESSION_IDLE_MS } from "../middleware/sessionAuth";
import { hashPassword } from "./passwordHasher";

const PASSWORD = "correct-password-123";

describe("authRoutes（単体テスト）", () => {
  let t: TestDb;
  let passwordHash: string;

  beforeAll(async () => {
    passwordHash = await hashPassword(PASSWORD);
  });

  beforeEach(() => {
    t = createTestDb();
    t.db
      .insert(admin_account)
      .values({
        admin_id: TEST_ADMIN_ID,
        display_name: "Kaine Yamashiro",
        password_hash: passwordHash,
        failed_count: 0,
        locked_until: null,
        updated_at: TEST_NOW.toISOString(),
      })
      .run();
  });

  afterEach(() => t.cleanup());

  function build() {
    const deps = testDeps(t.db);
    return { app: createAdminApp(deps, { staticDir: null }), clock: deps.clock };
  }

  const postLogin = (app: ReturnType<typeof build>["app"], body: string) =>
    app.request("/admin/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body });

  async function loginCookie(app: ReturnType<typeof build>["app"]) {
    const res = await postLogin(app, JSON.stringify({ password: PASSWORD }));
    const cookie = /aisns_admin=([^;]+)/.exec(res.headers.get("Set-Cookie") ?? "")?.[1] ?? "";
    const { csrfToken } = (await res.json()) as { csrfToken: string };
    return { cookie, csrfToken };
  }

  it.each([
    ["JSON でない本文", "password=abc"],
    ["空の本文", ""],
    ["password が数値", JSON.stringify({ password: 123456789012 })],
  ])(
    "TC-UT_AUTH-015 本文が読めない・password が文字列でないときは 400 で「パスワードを入力してください」（%s）",
    async (_label, body) => {
      const res = await postLogin(build().app, body);

      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        error: { code: "VALIDATION_ERROR", fields: { password: "パスワードを入力してください" } },
      });
    },
  );

  it.each([
    ["12 字", "a".repeat(12)],
    ["128 字", "a".repeat(128)],
  ])("TC-UT_AUTH-016 12 字・128 字は検証を通り、照合の結果（401）になる（%s）", async (_label, password) => {
    const res = await postLogin(build().app, JSON.stringify({ password }));

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "LOGIN_FAILED" } });
  });

  it("TC-UT_AUTH-017 最終操作から 60 分たったセッションで GET /session は 401", async () => {
    const { app, clock } = build();
    const { cookie } = await loginCookie(app);

    await clock.advance(SESSION_IDLE_MS);
    const res = await app.request("/admin/api/session", { headers: { Cookie: `${ADMIN_COOKIE}=${cookie}` } });

    expect(res.status).toBe(401);
  });

  it("TC-UT_AUTH-018 logout したあとは同じ Cookie で GET /session が 401 になる", async () => {
    const { app } = build();
    const { cookie, csrfToken } = await loginCookie(app);

    const out = await app.request("/admin/api/logout", {
      method: "POST",
      headers: { Cookie: `${ADMIN_COOKIE}=${cookie}`, [CSRF_HEADER]: csrfToken },
    });
    const res = await app.request("/admin/api/session", { headers: { Cookie: `${ADMIN_COOKIE}=${cookie}` } });

    expect(out.status).toBe(204);
    expect(res.status).toBe(401);
  });

  it("TC-UT_AUTH-019 GET /session は呼ぶたびに expiresAt を今から 60 分後に延ばす", async () => {
    const { app, clock } = build();
    const { cookie } = await loginCookie(app);

    await clock.advance(30 * 60 * 1000);
    const res = await app.request("/admin/api/session", { headers: { Cookie: `${ADMIN_COOKIE}=${cookie}` } });

    expect(await res.json()).toMatchObject({
      expiresAt: new Date(TEST_NOW.getTime() + 30 * 60 * 1000 + SESSION_IDLE_MS).toISOString(),
    });
  });
});
