import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useConsecutiveFailures, useVisibilityPolling } from "./useVisibilityPolling";

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
}

afterEach(() => setVisibility("visible"));

describe("useVisibilityPolling", () => {
  it("TC-NOUS49_DEV-15 前面なら 30 秒、隠れたら false、戻ったら 30 秒", () => {
    setVisibility("visible");
    const { result } = renderHook(() => useVisibilityPolling());
    expect(result.current).toBe(30_000);
    act(() => setVisibility("hidden"));
    expect(result.current).toBe(false);
    act(() => setVisibility("visible"));
    expect(result.current).toBe(30_000);
  });
});

describe("useConsecutiveFailures", () => {
  it("TC-NOUS49_DEV-16 失敗のたびに増え、成功で 0 に戻る", () => {
    const { result, rerender } = renderHook(
      (q: { errorUpdatedAt: number; dataUpdatedAt: number }) => useConsecutiveFailures(q),
      { initialProps: { errorUpdatedAt: 0, dataUpdatedAt: 100 } },
    );
    expect(result.current).toBe(0);
    rerender({ errorUpdatedAt: 200, dataUpdatedAt: 100 });
    rerender({ errorUpdatedAt: 300, dataUpdatedAt: 100 });
    rerender({ errorUpdatedAt: 400, dataUpdatedAt: 100 });
    expect(result.current).toBe(3);
    rerender({ errorUpdatedAt: 400, dataUpdatedAt: 500 });
    expect(result.current).toBe(0);
  });
});
