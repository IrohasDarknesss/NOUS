import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { captureLogger } from "../../../test/helpers/adminTestSupport";
import type { AdminEnv, AdminSession } from "../context";
import { CSRF_HEADER, requireCsrf } from "./csrf";
import { errorHandler } from "./errorHandler";

const admin: AdminSession = {
  adminId: "a",
  displayName: "Kaine Yamashiro",
  csrfToken: "csrf-token-value",
  sessionHash: "h",
  createdAt: "2026-10-20T00:00:00.000Z",
};

function app() {
  const a = new Hono<AdminEnv>();
  a.onError(errorHandler);
  a.use("*", async (c, next) => {
    c.set("logger", captureLogger().logger);
    c.set("admin", admin);
    await next();
  });
  a.use("*", requireCsrf);
  a.on(["GET", "POST", "PUT", "DELETE"], "/x", (c) => c.text("ok"));
  return a;
}

describe("csrf", () => {
  it("TC-NOUS52_DEV-06 GET は X-CSRF-Token なしで通る", async () => {
    expect((await app().request("/x")).status).toBe(200);
  });

  it("TC-NOUS52_DEV-07 POST・PUT・DELETE は一致するトークンで通る", async () => {
    for (const method of ["POST", "PUT", "DELETE"]) {
      const res = await app().request("/x", { method, headers: { [CSRF_HEADER]: admin.csrfToken } });
      expect(res.status).toBe(200);
    }
  });

  it("TC-NOUS52_DEV-08 トークンがない・違うなら 403 CSRF_INVALID", async () => {
    for (const headers of [
      {} as Record<string, string>,
      { [CSRF_HEADER]: "csrf-token-valuX" },
      { [CSRF_HEADER]: "short" },
    ]) {
      const res = await app().request("/x", { method: "POST", headers });
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ error: { code: "CSRF_INVALID" } });
    }
  });
});
