const DAY_SEC = 86400;

const pad2 = (n: number): string => String(n).padStart(2, "0");

/** 世界内時間（開始からの経過秒）を「第 N 日 HH:MM」にする */
export function formatWorldTime(worldTimeSec: number): string {
  const sec = Math.max(0, Math.floor(worldTimeSec));
  const day = Math.floor(sec / DAY_SEC) + 1;
  const hour = Math.floor((sec % DAY_SEC) / 3600);
  const minute = Math.floor((sec % 3600) / 60);
  return `第 ${day} 日 ${pad2(hour)}:${pad2(minute)}`;
}

const clockFormat = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** 端末の時刻を JST の「HH:MM」にする（フッターの最終更新） */
export function formatClockJst(date: Date): string {
  return clockFormat.format(date);
}
