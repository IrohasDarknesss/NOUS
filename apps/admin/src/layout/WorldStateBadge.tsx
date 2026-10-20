// 世界の状態の色付きのバッジ（基本設計書 3章の色）
import type { StopReason, WorldState } from "@nous/shared";
import { worldStateColors } from "../shared/theme";

export const WORLD_STATE_LABELS: Record<WorldState, string> = {
  preparing: "準備中",
  running: "稼働",
  paused: "一時停止",
  limit_stopped: "上限停止",
  emergency_stopped: "緊急停止",
  archived: "アーカイブ",
};

const STOP_REASON_LABELS: Record<StopReason, string> = {
  neurons_limit: "Neurons の上限",
  runs_limit: "生成の回数の上限",
  free_tier_error: "無料枠の上限（Cloudflare）",
  manual_pause: "一時停止",
  emergency: "緊急停止",
};

export function formatStopReason(stopReason: string | null | undefined): string {
  if (!stopReason) return "";
  return STOP_REASON_LABELS[stopReason as StopReason] ?? stopReason;
}

export interface WorldStateBadgeProps {
  state: WorldState;
  stopReason?: string | null;
}

export function WorldStateBadge({ state, stopReason }: WorldStateBadgeProps) {
  const reason = state === "limit_stopped" ? formatStopReason(stopReason) : "";
  return (
    <span
      data-state={state}
      style={{
        display: "inline-block",
        padding: "2px 10px",
        borderRadius: 4,
        background: worldStateColors[state],
        color: "#FFFFFF",
        fontWeight: 600,
        fontSize: 13,
      }}
    >
      {WORLD_STATE_LABELS[state]}
      {reason && `（${reason}）`}
    </span>
  );
}
