// 単体テスト（NOUS-106）。観点表は docs/test/unit/NOUS-106/観点表_hooks.json
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setVisibility } from "../test/observerUt";
import { POLLING_FAILURE_THRESHOLD, useConsecutiveFailures, useVisibilityPolling } from "./useVisibilityPolling";

afterEach(() => {
  vi.restoreAllMocks();
  setVisibility("visible");
});

describe("useVisibilityPolling（単体テスト）", () => {
  it("TC-UT_OWEB-020 intervalMs を渡すと、前面のときその値を返す", () => {
    setVisibility("visible");

    const { result } = renderHook(() => useVisibilityPolling(5_000));

    expect(result.current).toBe(5_000);
  });

  it("TC-UT_OWEB-021 隠れた状態で始まると false を返し、前面に戻ると 30 秒にする", () => {
    setVisibility("hidden");
    const { result } = renderHook(() => useVisibilityPolling());
    const before = result.current;

    act(() => setVisibility("visible"));

    expect(before).toBe(false);
    expect(result.current).toBe(30_000);
  });

  it("TC-UT_OWEB-022 unmount すると visibilitychange の購読を外す", () => {
    const remove = vi.spyOn(document, "removeEventListener");
    const { unmount } = renderHook(() => useVisibilityPolling());

    unmount();

    expect(remove).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
  });

  it("TC-UT_OWEB-023 失敗が 2 回続くと 2、3 回続くとしきい値の 3 になる", () => {
    const { result, rerender } = renderHook(
      (q: { errorUpdatedAt: number; dataUpdatedAt: number }) => useConsecutiveFailures(q),
      {
        initialProps: { errorUpdatedAt: 0, dataUpdatedAt: 100 },
      },
    );

    rerender({ errorUpdatedAt: 200, dataUpdatedAt: 100 });
    rerender({ errorUpdatedAt: 300, dataUpdatedAt: 100 });
    const afterTwo = result.current;
    rerender({ errorUpdatedAt: 400, dataUpdatedAt: 100 });

    expect(afterTwo).toBe(2);
    expect(result.current).toBe(POLLING_FAILURE_THRESHOLD);
  });

  it("TC-UT_OWEB-024 dataUpdatedAt が変わっても errorUpdatedAt より古ければ 0 に戻さない", () => {
    const { result, rerender } = renderHook(
      (q: { errorUpdatedAt: number; dataUpdatedAt: number }) => useConsecutiveFailures(q),
      {
        initialProps: { errorUpdatedAt: 0, dataUpdatedAt: 100 },
      },
    );
    rerender({ errorUpdatedAt: 500, dataUpdatedAt: 100 });

    rerender({ errorUpdatedAt: 500, dataUpdatedAt: 400 });

    expect(result.current).toBe(1);
  });

  it("TC-UT_OWEB-025 最初の描画では、値が 0 でなくても数えない", () => {
    const { result } = renderHook(() => useConsecutiveFailures({ errorUpdatedAt: 900, dataUpdatedAt: 100 }));

    expect(result.current).toBe(0);
  });
});
