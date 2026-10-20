// 世界の状態の遷移の表と判定（BE 詳細設計 world 4章 canTransition、基本設計書 概要 6章「世界の状態」）
import type { WORLD_STATES } from "../db/schema";

export type WorldState = (typeof WORLD_STATES)[number];

/** 遷移の表（基本設計書 6章の 11 行。複数の遷移元をまとめた行は 1 組ずつに展開している） */
export const WORLD_TRANSITIONS: ReadonlyArray<readonly [from: WorldState, to: WorldState]> = [
  ["preparing", "running"],
  ["running", "paused"],
  ["paused", "running"],
  ["paused", "limit_stopped"],
  ["limit_stopped", "paused"],
  ["running", "limit_stopped"],
  ["limit_stopped", "running"],
  ["running", "emergency_stopped"],
  ["paused", "emergency_stopped"],
  ["limit_stopped", "emergency_stopped"],
  ["emergency_stopped", "running"],
  ["emergency_stopped", "limit_stopped"],
  // リセット：preparing 以外の現在の世界。running からは直接リセットできない
  ["paused", "archived"],
  ["limit_stopped", "archived"],
  ["emergency_stopped", "archived"],
];

/** from から to へ遷移できるか */
export function canTransition(from: WorldState, to: WorldState): boolean {
  return WORLD_TRANSITIONS.some(([f, t]) => f === from && t === to);
}
