// P102 から戻ったときにタイムラインのスクロール位置を戻す（sessionStorage が使えなければ何もしない）
export const TIMELINE_SCROLL_KEY = "nous.timeline.scrollY";

export function saveTimelineScroll(): void {
  try {
    window.sessionStorage.setItem(TIMELINE_SCROLL_KEY, String(window.scrollY));
  } catch {
    // 保存できなくても画面は動かす
  }
}

export function restoreTimelineScroll(): void {
  try {
    const saved = window.sessionStorage.getItem(TIMELINE_SCROLL_KEY);
    if (saved === null) return;
    window.sessionStorage.removeItem(TIMELINE_SCROLL_KEY);
    const y = Number(saved);
    if (Number.isFinite(y)) window.scrollTo(0, y);
  } catch {
    // 復元できなければ先頭のまま
  }
}
