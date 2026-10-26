// 単体テスト（NOUS-106）。観点表は docs/test/unit/NOUS-106/観点表_hooks.json
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  advance,
  restoreRealTimers,
  calledUrls,
  errorResponse,
  makeClient,
  queryWrapper,
  setVisibility,
  stubFetch,
  useFakePollingTimers,
} from "../test/observerUt";
import { useWorldStatus } from "./useWorldStatus";

afterEach(() => {
  cleanup();
  restoreRealTimers();
  vi.unstubAllGlobals();
  setVisibility("visible");
});

describe("useWorldStatus（単体テスト）", () => {
  it("TC-UT_OWEB-026 成功の前は world も lastUpdated も無く、成功すると取得の時刻を lastUpdated にする", async () => {
    useFakePollingTimers("2026-10-22T05:21:00.000Z");
    stubFetch();
    const { result } = renderHook(() => useWorldStatus(), { wrapper: queryWrapper(makeClient()) });
    const before = { ...result.current };

    await advance();

    expect(before).toEqual({ world: undefined, lastUpdated: null, isError: false });
    expect(result.current.world?.state).toBe("running");
    expect(result.current.lastUpdated?.toISOString()).toBe("2026-10-22T05:21:00.000Z");
  });

  it("TC-UT_OWEB-027 取得に失敗すると isError を true にし、lastUpdated は null のまま", async () => {
    stubFetch(() => errorResponse(500, "INTERNAL"));

    const { result } = renderHook(() => useWorldStatus(), { wrapper: queryWrapper(makeClient()) });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.lastUpdated).toBeNull();
  });

  it("TC-UT_OWEB-028 前面のときは 30 秒ごとに取り直し、隠れている間は取りに行かない", async () => {
    useFakePollingTimers();
    setVisibility("visible");
    const mock = stubFetch();
    renderHook(() => useWorldStatus(), { wrapper: queryWrapper(makeClient()) });
    await advance();
    await advance(29_999);
    const before30s = calledUrls(mock, "/api/world").length;
    await advance(1);
    const at30s = calledUrls(mock, "/api/world").length;

    setVisibility("hidden");
    await advance(90_000);

    expect(before30s).toBe(1);
    expect(at30s).toBe(2);
    expect(calledUrls(mock, "/api/world")).toHaveLength(2);
  });
});
