// 単体テスト（NOUS-91）。観点表は docs/test/unit/NOUS-91/観点表_admin_common.json
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { captureLogger } from "../../../test/helpers/adminTestSupport";
import type { AdminEnv, AdminSession } from "../context";
import { CSRF_HEADER, requireCsrf } from "./csrf";
import { errorHandler } from "./errorHandler";

const TOKEN = "C".repeat(43);

const session: AdminSession = {
  adminId: "01JB00000000000000000ADMIN",
  displayName: "Kaine Yamashiro",
  csrfToken: TOKEN,
  sessionHash: "h",
  createdAt: "2026-10-20T00:00:00.000Z",
};

/** requireCsrf だけを掛けたアプリ。withAdmin が偽なら c.var.admin を入れない */
function app(withAdmin = true) {
  const a = new Hono<AdminEnv>();
  a.onError(errorHandler);
  a.use("*", async (c, next) => {
    c.set("logger", captureLogger().logger);
    if (withAdmin) c.set("admin", session);
    await next();
  });
  a.use("*", requireCsrf);
  a.all("/x", (c) => c.json({ ok: true }));
  return a;
}

describe("csrf（単体テスト）", () => {
  it("TC-UT_ADM-009 トークンが合っていても、requireAdminSession を通っていない（c.var.admin がない）なら 403", async () => {
    const res = await app(false).request("/x", { method: "POST", headers: { [CSRF_HEADER]: TOKEN } });

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: "CSRF_INVALID" } });
  });

  it("TC-UT_ADM-010 PATCH も変更の要求として CSRF を確かめる", async () => {
    const without = await app().request("/x", { method: "PATCH" });
    const withToken = await app().request("/x", { method: "PATCH", headers: { [CSRF_HEADER]: TOKEN } });

    expect(without.status).toBe(403);
    expect(withToken.status).toBe(200);
  });

  it("TC-UT_ADM-011 ヘッダーの名前は大文字小文字を問わない", async () => {
    const res = await app().request("/x", { method: "POST", headers: { "x-csrf-token": TOKEN } });

    expect(res.status).toBe(200);
  });

  it.each([
    ["1 字短い", TOKEN.slice(1)],
    ["最後の 1 字だけ違う", `${TOKEN.slice(0, 42)}D`],
    ["空", ""],
  ])("TC-UT_ADM-012 トークンの長さ・中身が少しでも違えば 403（%s）", async (_label, header) => {
    const res = await app().request("/x", { method: "DELETE", headers: { [CSRF_HEADER]: header } });

    expect(res.status).toBe(403);
  });
});
