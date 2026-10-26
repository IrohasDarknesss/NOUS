// 単体テスト（NOUS-106）。観点表は docs/test/unit/NOUS-106/観点表_api_lib.json
import { afterEach, describe, expect, it, vi } from "vitest";
import { restoreTimelineScroll, saveTimelineScroll, TIMELINE_SCROLL_KEY } from "./scrollRestore";

afterEach(() => {
  vi.restoreAllMocks();
  window.sessionStorage.clear();
});

describe("scrollRestore（単体テスト）", () => {
  it("TC-UT_OWEB-016 sessionStorage に保存できなくても saveTimelineScroll は例外を出さない", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });

    expect(() => saveTimelineScroll()).not.toThrow();
  });

  it("TC-UT_OWEB-017 保存した値が数でなければスクロールせず、キーは消す", () => {
    window.sessionStorage.setItem(TIMELINE_SCROLL_KEY, "abc");
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});

    restoreTimelineScroll();

    expect(scrollTo).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(TIMELINE_SCROLL_KEY)).toBeNull();
  });

  it("TC-UT_OWEB-018 sessionStorage を読めなくても restoreTimelineScroll は例外を出さず、スクロールしない", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});

    expect(() => restoreTimelineScroll()).not.toThrow();

    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("TC-UT_OWEB-019 保存した位置が 0 なら先頭（0, 0）へスクロールする", () => {
    window.sessionStorage.setItem(TIMELINE_SCROLL_KEY, "0");
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});

    restoreTimelineScroll();

    expect(scrollTo).toHaveBeenCalledWith(0, 0);
  });
});
