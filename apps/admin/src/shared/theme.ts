// 管理画面の色と文字の大きさ（基本設計書 3章 カラーテーマ）
import type { WorldState } from "@nous/shared";

export const colors = {
  sideMenu: "#1E293B",
  sideMenuText: "#E2E8F0",
  sideMenuActive: "#334155",
  background: "#F1F5F9",
  surface: "#FFFFFF",
  text: "#0F172A",
  subText: "#64748B",
  border: "#CBD5E1",
  primary: "#2563EB",
  danger: "#DC2626",
  dangerBg: "#FEE2E2",
  warning: "#CA8A04",
  success: "#16A34A",
  aiBadge: "#7C3AED",
} as const;

/** 世界の状態の色（稼働・一時停止・上限停止・緊急停止・準備中） */
export const worldStateColors: Record<WorldState, string> = {
  running: "#16A34A",
  paused: "#CA8A04",
  limit_stopped: "#EA580C",
  emergency_stopped: "#DC2626",
  preparing: "#64748B",
  archived: "#94A3B8",
};

export const fontSizes = {
  body: 14,
  table: 13,
  heading: 18,
} as const;

export const fontFamily = 'system-ui, "Hiragino Sans", "Noto Sans JP", sans-serif';
