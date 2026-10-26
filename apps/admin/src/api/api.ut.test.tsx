// 単体テスト（NOUS-99）。観点表は docs/test/unit/NOUS-99/観点表_AWEB_api.json
import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getCsrfToken, setCsrfToken } from "../session/csrfToken";
import { ErrorProvider, useErrorState } from "../shared/ErrorContext";
import { jsonResponse, mockFetch, worldOk } from "../test/fetchMock";
import { createTestQueryClient } from "../test/renderApp";
import { adminFetch, ApiError, NetworkError } from "./client";
import { login, logout } from "./session";
import { getSettings, updateSettings } from "./settings";
import {
  adminWorldQueryKey,
  emergencyStop,
  getAuditLogs,
  pause,
  reset,
  resume,
  start,
  useAdminWorld,
  WORLD_FETCH_FAILED_MESSAGE,
} from "./world";

function initOf(mock: ReturnType<typeof mockFetch>, call = 0): RequestInit {
  return mock.mock.calls[call]?.[1] ?? {};
}

function headersOf(mock: ReturnType<typeof mockFetch>, call = 0): Record<string, string> {
  return (initOf(mock, call).headers ?? {}) as Record<string, string>;
}

/** fetch を、決まった Response を返す（または投げる）ものに差し替える */
function stubFetch(impl: () => Promise<Response>) {
  const mock = vi.fn(impl);
  vi.stubGlobal("fetch", mock);
  return mock;
}

async function catchError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (e) {
    return e;
  }
  throw new Error("例外が投げられませんでした");
}

beforeEach(() => setCsrfToken("csrf-abc"));

afterEach(() => {
  vi.unstubAllGlobals();
  setCsrfToken(null);
});

describe("adminFetch（単体テスト）", () => {
  it("TC-UT_AWEB-001 2xx で本文が空なら NetworkError（応答を読み取れませんでした）にする", async () => {
    stubFetch(async () => new Response(null, { status: 200 }));

    const err = await catchError(adminFetch("/admin/api/world"));

    expect(err).toBeInstanceOf(NetworkError);
    expect((err as Error).message).toBe("応答を読み取れませんでした");
  });

  it("TC-UT_AWEB-002 要求を abort したときは NetworkError にせず AbortError をそのまま投げる", async () => {
    stubFetch(async () => {
      throw new DOMException("aborted", "AbortError");
    });

    const err = await catchError(adminFetch("/admin/api/world"));

    expect(err).toBeInstanceOf(DOMException);
    expect((err as DOMException).name).toBe("AbortError");
  });

  it("TC-UT_AWEB-003 4xx で本文が JSON でなければ、code UNKNOWN の ApiError にする", async () => {
    stubFetch(async () => new Response("Not Found", { status: 404, statusText: "Not Found" }));

    const err = await catchError(adminFetch("/admin/api/world"));

    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 404, code: "UNKNOWN" });
  });

  it("TC-UT_AWEB-004 本文の error に code がなければ API のエラーの形とみなさない（400 は UNKNOWN）", async () => {
    stubFetch(async () => jsonResponse({ status: 400, body: { error: "bad" } }));

    const err = await catchError(adminFetch("/admin/api/settings", { method: "PUT", body: {} }));

    expect(err).toMatchObject({ status: 400, code: "UNKNOWN", fields: undefined });
  });

  it("TC-UT_AWEB-005 手元に CSRF トークンがなければ、POST でも X-CSRF-Token を付けない", async () => {
    setCsrfToken(null);
    const mock = mockFetch({ "POST /admin/api/world/pause": { status: 200, body: { state: "paused" } } });

    await adminFetch("/admin/api/world/pause", { method: "POST" });

    expect(headersOf(mock)["X-CSRF-Token"]).toBeUndefined();
  });

  it("TC-UT_AWEB-006 csrf: true なら GET でも X-CSRF-Token を付け、本文がなければ Content-Type を付けない", async () => {
    const mock = mockFetch({ "GET /admin/api/world": worldOk });

    await adminFetch("/admin/api/world", { csrf: true });

    expect(headersOf(mock)["X-CSRF-Token"]).toBe("csrf-abc");
    expect(headersOf(mock)["Content-Type"]).toBeUndefined();
  });
});

describe("api の関数（単体テスト）", () => {
  it("TC-UT_AWEB-007 login は POST /admin/api/login に { password } を X-CSRF-Token なしで送り、logout は X-CSRF-Token を付けて送る", async () => {
    const mock = mockFetch({
      "POST /admin/api/login": { status: 200, body: { displayName: "Kaine Yamashiro", csrfToken: "t2" } },
      "POST /admin/api/logout": { status: 204 },
    });

    await login("correct-horse-battery");
    await logout();

    expect(initOf(mock, 0).body).toBe(JSON.stringify({ password: "correct-horse-battery" }));
    expect(headersOf(mock, 0)["X-CSRF-Token"]).toBeUndefined();
    expect(mock.mock.calls[1]?.[0]).toBe("/admin/api/logout");
    expect(headersOf(mock, 1)["X-CSRF-Token"]).toBe("csrf-abc");
  });

  it.each([
    ["start", () => start(), "/admin/api/world/start"],
    ["pause", () => pause(), "/admin/api/world/pause"],
    ["resume", () => resume(), "/admin/api/world/resume"],
    ["emergencyStop", () => emergencyStop(), "/admin/api/world/emergency-stop"],
    ["reset", () => reset({ confirmName: "世界 2026-10-22" }), "/admin/api/world/reset"],
  ] as const)(
    "TC-UT_AWEB-008 世界の操作の関数は、対応するパスに X-CSRF-Token を付けて POST する（%s）",
    async (_name, call, path) => {
      const mock = mockFetch({ [`POST ${path}`]: { status: 200, body: {} } });

      await call();

      expect(mock.mock.calls[0]?.[0]).toBe(path);
      expect(initOf(mock).method).toBe("POST");
      expect(headersOf(mock)["X-CSRF-Token"]).toBe("csrf-abc");
    },
  );

  it("TC-UT_AWEB-009 getAuditLogs は既定で limit=10、引数を渡せばその件数で GET する", async () => {
    const mock = mockFetch({ "GET /admin/api/audit-logs": { status: 200, body: { items: [], nextCursor: null } } });

    await getAuditLogs();
    await getAuditLogs(3);

    expect(mock.mock.calls[0]?.[0]).toBe("/admin/api/audit-logs?limit=10");
    expect(mock.mock.calls[1]?.[0]).toBe("/admin/api/audit-logs?limit=3");
  });

  it("TC-UT_AWEB-010 getSettings は GET、updateSettings は本文つきで PUT し X-CSRF-Token を付ける", async () => {
    const mock = mockFetch({
      "GET /admin/api/settings": { status: 200, body: {} },
      "PUT /admin/api/settings": { status: 200, body: {} },
    });
    const body = { cycleMinutes: 30 } as unknown as Parameters<typeof updateSettings>[0];

    await getSettings();
    await updateSettings(body);

    expect(initOf(mock, 0).method).toBe("GET");
    expect(initOf(mock, 1).method).toBe("PUT");
    expect(initOf(mock, 1).body).toBe(JSON.stringify(body));
    expect(headersOf(mock, 1)["X-CSRF-Token"]).toBe("csrf-abc");
  });
});

describe("useAdminWorld（単体テスト）", () => {
  function setup(responses: Array<"ok" | "fail">) {
    let call = 0;
    stubFetch(async () => {
      const kind = responses[Math.min(call, responses.length - 1)];
      call += 1;
      return kind === "ok"
        ? jsonResponse(worldOk)
        : jsonResponse({ status: 500, body: { error: { code: "INTERNAL_ERROR", message: "x" } } });
    });
    const queryClient = createTestQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <ErrorProvider>{children}</ErrorProvider>
      </QueryClientProvider>
    );
    const hook = renderHook(() => ({ world: useAdminWorld(), errors: useErrorState() }), { wrapper });
    const refetch = async () => {
      await act(async () => {
        await queryClient.refetchQueries({ queryKey: adminWorldQueryKey });
      });
    };
    return { hook, refetch, calls: () => call };
  }

  it("TC-UT_AWEB-011 取得が 2 回続けて失敗しても様式②を出さず、3 回目の失敗で「最新の状態を取得できていません」を出す", async () => {
    const { hook, refetch, calls } = setup(["fail"]);
    await waitFor(() => expect(hook.result.current.world.isError).toBe(true));

    await refetch();
    const afterTwo = hook.result.current.errors.banner;
    await refetch();

    expect(calls()).toBe(3);
    expect(afterTwo).toBeNull();
    expect(hook.result.current.errors.banner).toBe(WORLD_FETCH_FAILED_MESSAGE);
  });

  it("TC-UT_AWEB-012 途中で 1 回成功すれば失敗の回数を数え直し、その後 2 回失敗しても様式②を出さない", async () => {
    const { hook, refetch, calls } = setup(["fail", "fail", "ok", "fail", "fail"]);
    await waitFor(() => expect(hook.result.current.world.isError).toBe(true));

    await refetch();
    await refetch();
    await refetch();
    await refetch();

    expect(calls()).toBe(5);
    expect(hook.result.current.errors.banner).toBeNull();
  });
});

describe("csrfToken（単体テスト）", () => {
  it("TC-UT_AWEB-013 CSRF トークンはメモリだけに置き、localStorage・sessionStorage に書かない", () => {
    setCsrfToken("csrf-memory-only");

    const token = getCsrfToken();

    expect(token).toBe("csrf-memory-only");
    expect(JSON.stringify({ ...localStorage })).not.toContain("csrf-memory-only");
    expect(JSON.stringify({ ...sessionStorage })).not.toContain("csrf-memory-only");
  });
});
