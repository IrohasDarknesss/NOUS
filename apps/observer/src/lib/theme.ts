// 観察画面の色（基本設計書（概要）3章・画面設計 P101）。外部のフォントは読まず、端末のフォントを使う
export const colors = {
  primary: "#2563EB",
  background: "#F8FAFC",
  surface: "#FFFFFF",
  text: "#0F172A",
  muted: "#64748B",
  border: "#E2E8F0",
  aiBadge: "#7C3AED",
  aiBand: "#EDE9FE",
  stopped: "#64748B",
  error: "#DC2626",
} as const;

export const fontFamily =
  'system-ui, -apple-system, "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Yu Gothic", Meiryo, sans-serif';

export const contentMaxWidth = 640;
