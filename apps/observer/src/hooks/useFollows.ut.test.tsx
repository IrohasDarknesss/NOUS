// 単体テスト（NOUS-106）。観点表は docs/test/unit/NOUS-106/観点表_hooks.json
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { errorResponse, makeClient, queryWrapper, stubFetch } from "../test/observerUt";
import { useFollows } from "./useFollows";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useFollows（単体テスト）", () => {
  it("TC-UT_OWEB-041 agentId が空なら取りに行かず、items は空にする", () => {
    const mock = stubFetch();

    const { result } = renderHook(() => useFollows("", "following"), { wrapper: queryWrapper(makeClient()) });

    expect(result.current).toMatchObject({ items: [], isLoading: false, isSuccess: false });
    expect(mock).not.toHaveBeenCalled();
  });

  it("TC-UT_OWEB-042 取得に失敗したら error を返し、items は空のままにする", async () => {
    stubFetch(() => errorResponse(500, "INTERNAL"));

    const { result } = renderHook(() => useFollows("01A", "followers"), { wrapper: queryWrapper(makeClient()) });

    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.items).toEqual([]);
    expect(result.current.isSuccess).toBe(false);
  });
});
