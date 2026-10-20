import { afterEach, describe, expect, it, vi } from "vitest";
import { restoreTimelineScroll, saveTimelineScroll, TIMELINE_SCROLL_KEY } from "./scrollRestore";

afterEach(() => {
  vi.restoreAllMocks();
  window.sessionStorage.clear();
});

describe("scrollRestore", () => {
  it("TC-NOUS49_DEV-13 保存した位置に戻し、キーを消す", () => {
    Object.defineProperty(window, "scrollY", { configurable: true, value: 420 });
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    saveTimelineScroll();
    expect(window.sessionStorage.getItem(TIMELINE_SCROLL_KEY)).toBe("420");
    restoreTimelineScroll();
    expect(scrollTo).toHaveBeenCalledWith(0, 420);
    expect(window.sessionStorage.getItem(TIMELINE_SCROLL_KEY)).toBeNull();
  });

  it("TC-NOUS49_DEV-14 保存が無ければ何もしない", () => {
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    restoreTimelineScroll();
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
