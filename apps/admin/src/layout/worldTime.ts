// 世界内時間を「第 N 日 HH:MM」にする（世界の開始を第 1 日 00:00 とする。基本設計書 3章）
export function formatWorldTime(worldTimeSec: number): string {
  const sec = Math.max(0, Math.floor(worldTimeSec));
  const day = Math.floor(sec / 86_400) + 1;
  const rest = sec % 86_400;
  const hh = String(Math.floor(rest / 3600)).padStart(2, "0");
  const mm = String(Math.floor((rest % 3600) / 60)).padStart(2, "0");
  return `第 ${day} 日 ${hh}:${mm}`;
}
