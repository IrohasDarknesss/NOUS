// 単体テスト（NOUS-106）。観点表は docs/test/unit/NOUS-106/観点表_api_lib.json
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, fetchJson, navigation, NetworkError, NotInvitedError } from "./client";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function stubResponse(res: Response) {
  const mock = vi.fn().mockResolvedValue(res);
  vi.stubGlobal("fetch", mock);
  return mock;
}

describe("client（単体テスト）", () => {
  it("TC-UT_OWEB-001 fetchJson は init を引き継ぎ、credentials は same-origin で上書きする", async () => {
    const mock = stubResponse(new Response("{}", { status: 200 }));

    await fetchJson("/api/world", { method: "GET", headers: { "X-Test": "1" }, credentials: "include" });

    expect(mock).toHaveBeenCalledWith("/api/world", {
      method: "GET",
      headers: { "X-Test": "1" },
      credentials: "same-origin",
    });
  });

  it("TC-UT_OWEB-002 401 のときは本文を読まずに /not-invited へ移す", async () => {
    const res = new Response(JSON.stringify({ error: { code: "VIEW_NOT_INVITED", message: "x" } }), { status: 401 });
    const json = vi.spyOn(res, "json");
    stubResponse(res);
    const toNotInvited = vi.spyOn(navigation, "toNotInvited").mockImplementation(() => {});

    const promise = fetchJson("/api/timeline");

    await expect(promise).rejects.toBeInstanceOf(NotInvitedError);
    expect(toNotInvited).toHaveBeenCalledTimes(1);
    expect(json).not.toHaveBeenCalled();
  });

  it.each([
    { status: 404, code: "POST_NOT_FOUND" },
    { status: 403, code: "VIEW_FORBIDDEN" },
    { status: 400, code: "VALIDATION_ERROR" },
  ])(
    "TC-UT_OWEB-003 2xx 以外で本文に error があれば、status と code の ApiError にし、/not-invited へは移さない（$status）",
    async ({ status, code }) => {
      stubResponse(new Response(JSON.stringify({ error: { code, message: "msg" } }), { status }));
      const toNotInvited = vi.spyOn(navigation, "toNotInvited").mockImplementation(() => {});

      const err = await fetchJson("/api/x").catch((e: unknown) => e);

      expect(err).toBeInstanceOf(ApiError);
      expect(err).toMatchObject({ status, code, message: "msg" });
      expect(toNotInvited).not.toHaveBeenCalled();
    },
  );

  it.each([
    { label: "error の無いオブジェクト", body: '{"message":"x"}' },
    { label: "null", body: "null" },
    { label: "文字列", body: '"oops"' },
  ])(
    "TC-UT_OWEB-004 2xx 以外で本文が error の形でなければ code は null、message は HTTP の状態にする（$label）",
    async ({ body }) => {
      stubResponse(new Response(body, { status: 500 }));

      const err = await fetchJson("/api/x").catch((e: unknown) => e);

      expect(err).toBeInstanceOf(ApiError);
      expect(err).toMatchObject({ status: 500, code: null, message: "HTTP 500" });
    },
  );

  it("TC-UT_OWEB-005 2xx でも本文が JSON でなければ、ApiError・NetworkError にせず JSON の例外のまま投げる", async () => {
    stubResponse(new Response("not json", { status: 200 }));

    const err = await fetchJson("/api/x").catch((e: unknown) => e);

    expect(err).toBeInstanceOf(SyntaxError);
  });

  it("TC-UT_OWEB-006 NetworkError は元の例外を cause に持つ", async () => {
    const cause = new TypeError("Failed to fetch");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(cause));

    const err = await fetchJson("/api/x").catch((e: unknown) => e);

    expect(err).toBeInstanceOf(NetworkError);
    expect((err as NetworkError).cause).toBe(cause);
  });
});
