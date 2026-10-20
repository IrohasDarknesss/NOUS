import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getCsrfToken, setCsrfToken } from "../session/csrfToken";
import { mockFetch } from "../test/fetchMock";
import { adminFetch, ApiError, NetworkError } from "./client";

function headersOf(mock: ReturnType<typeof mockFetch>, call = 0): Record<string, string> {
  const init = mock.mock.calls[call]?.[1];
  return (init?.headers ?? {}) as Record<string, string>;
}

describe("adminFetch", () => {
  beforeEach(() => setCsrfToken("csrf-abc"));
  afterEach(() => {
    vi.unstubAllGlobals();
    setCsrfToken(null);
  });

  it("TC-NOUS50_DEV-01 GET には X-CSRF-Token を付けず、credentials は same-origin", async () => {
    const mock = mockFetch({ "GET /admin/api/world": { status: 200, body: { ok: true } } });
    await expect(adminFetch("/admin/api/world")).resolves.toEqual({ ok: true });
    expect(headersOf(mock)["X-CSRF-Token"]).toBeUndefined();
    expect(mock.mock.calls[0]?.[1]?.credentials).toBe("same-origin");
  });

  it("TC-NOUS50_DEV-02 GET 以外には X-CSRF-Token と Content-Type を付け、本文を JSON にする", async () => {
    const mock = mockFetch({ "POST /admin/api/world/reset": { status: 200, body: { state: "preparing" } } });
    await adminFetch("/admin/api/world/reset", { method: "POST", body: { confirmName: "世界" } });
    expect(headersOf(mock)["X-CSRF-Token"]).toBe("csrf-abc");
    expect(headersOf(mock)["Content-Type"]).toBe("application/json");
    expect(mock.mock.calls[0]?.[1]?.body).toBe(JSON.stringify({ confirmName: "世界" }));
  });

  it("TC-NOUS50_DEV-03 csrf: false なら POST でも X-CSRF-Token を付けない（login）", async () => {
    const mock = mockFetch({ "POST /admin/api/login": { status: 200, body: { displayName: "K", csrfToken: "t" } } });
    await adminFetch("/admin/api/login", { method: "POST", body: { password: "x" }, csrf: false });
    expect(headersOf(mock)["X-CSRF-Token"]).toBeUndefined();
  });

  it("TC-NOUS50_DEV-04 204 は undefined を返す", async () => {
    mockFetch({ "POST /admin/api/logout": { status: 204 } });
    await expect(adminFetch("/admin/api/logout", { method: "POST" })).resolves.toBeUndefined();
  });

  it("TC-NOUS50_DEV-05 2xx 以外は本文の error から ApiError（status・code・message・fields）にする", async () => {
    mockFetch({
      "PUT /admin/api/settings": {
        status: 400,
        body: { error: { code: "VALIDATION_ERROR", message: "入力の誤り", fields: { cycleMinutes: "範囲外" } } },
      },
    });
    const error = await adminFetch("/admin/api/settings", { method: "PUT", body: {} }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 400,
      code: "VALIDATION_ERROR",
      message: "入力の誤り",
      fields: { cycleMinutes: "範囲外" },
    });
  });

  it("TC-NOUS50_DEV-06 401 ADMIN_UNAUTHORIZED では手元の CSRF トークンを捨てる", async () => {
    mockFetch({
      "GET /admin/api/world": { status: 401, body: { error: { code: "ADMIN_UNAUTHORIZED", message: "x" } } },
    });
    await expect(adminFetch("/admin/api/world")).rejects.toMatchObject({ status: 401 });
    expect(getCsrfToken()).toBeNull();
  });

  it("TC-NOUS50_DEV-07 401 LOGIN_FAILED では CSRF トークンを捨てない", async () => {
    mockFetch({ "POST /admin/api/login": { status: 401, body: { error: { code: "LOGIN_FAILED", message: "x" } } } });
    await expect(adminFetch("/admin/api/login", { method: "POST", csrf: false })).rejects.toMatchObject({
      code: "LOGIN_FAILED",
    });
    expect(getCsrfToken()).toBe("csrf-abc");
  });

  it("TC-NOUS50_DEV-08 通信の失敗は NetworkError、本文が JSON でない 500 は INTERNAL_ERROR の ApiError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(adminFetch("/admin/api/world")).rejects.toBeInstanceOf(NetworkError);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>", { status: 502 })));
    await expect(adminFetch("/admin/api/world")).rejects.toMatchObject({ status: 502, code: "INTERNAL_ERROR" });
  });
});
