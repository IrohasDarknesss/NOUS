// P202 操作のボタン（ControlButtons）。画面基本設計書 P202 H12〜H16、FE 詳細設計 admin_control 2章・4章。
import type { WorldState } from "@nous/shared";
import { buttonStyle, dangerButtonStyle, primaryButtonStyle } from "../../shared/Modal";
import { colors } from "../../shared/theme";

export type ControlAction = "start" | "pause" | "resume" | "emergency" | "reset";

export interface ButtonState {
  enabled: boolean;
  reason: string | null;
}

export function buttonStates(state: WorldState, agentCount: number): Record<ControlAction, ButtonState> {
  const startEnabled = state === "preparing" && agentCount > 0;
  let startReason: string | null = null;
  if (!startEnabled) {
    if (state !== "preparing") {
      startReason = "準備中の世界だけ開始できます";
    } else {
      startReason = "エージェントが 0 体のため開始できません";
    }
  }

  const pauseEnabled = state === "running" || state === "limit_stopped";
  let pauseReason: string | null = null;
  if (!pauseEnabled) {
    if (state === "preparing") {
      pauseReason = "まだ開始していません";
    } else if (state === "paused") {
      pauseReason = "すでに一時停止しています";
    } else if (state === "emergency_stopped") {
      pauseReason = "緊急停止中です";
    } else {
      pauseReason = "稼働・上限停止のときだけ一時停止できます";
    }
  }

  const resumeEnabled = state === "paused" || state === "emergency_stopped";
  let resumeReason: string | null = null;
  if (!resumeEnabled) {
    if (state === "preparing") {
      resumeReason = "まだ開始していません";
    } else if (state === "running") {
      resumeReason = "すでに稼働しています";
    } else if (state === "limit_stopped") {
      resumeReason = "上限停止中です";
    } else {
      resumeReason = "一時停止・緊急停止のときだけ再開できます";
    }
  }

  const emergencyEnabled = state === "running" || state === "paused" || state === "limit_stopped";
  let emergencyReason: string | null = null;
  if (!emergencyEnabled) {
    if (state === "preparing") {
      emergencyReason = "まだ開始していません";
    } else if (state === "emergency_stopped") {
      emergencyReason = "すでに緊急停止しています";
    } else {
      emergencyReason = "現在は緊急停止できません";
    }
  }

  const resetEnabled = state === "paused" || state === "limit_stopped" || state === "emergency_stopped";
  let resetReason: string | null = null;
  if (!resetEnabled) {
    if (state === "running") {
      resetReason = "先に一時停止してください";
    } else if (state === "preparing") {
      resetReason = "まだ開始していない世界はリセットできません";
    } else {
      resetReason = "一時停止・上限停止・緊急停止のときだけリセットできます";
    }
  }

  return {
    start: { enabled: startEnabled, reason: startReason },
    pause: { enabled: pauseEnabled, reason: pauseReason },
    resume: { enabled: resumeEnabled, reason: resumeReason },
    emergency: { enabled: emergencyEnabled, reason: emergencyReason },
    reset: { enabled: resetEnabled, reason: resetReason },
  };
}

export interface ControlButtonsProps {
  state: WorldState;
  agentCount?: number;
  pending: ControlAction | null;
  onAction: (action: ControlAction) => void;
}

export function ControlButtons({ state, agentCount = 1, pending, onAction }: ControlButtonsProps) {
  const states = buttonStates(state, agentCount);
  const isBusy = pending !== null;

  const renderItem = (action: ControlAction, label: string, variant: "primary" | "default" | "danger") => {
    const info = states[action];
    const disabled = !info.enabled || isBusy;
    const baseStyle =
      variant === "danger" ? dangerButtonStyle : variant === "primary" ? primaryButtonStyle : buttonStyle;

    return (
      <div key={action} style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onAction(action)}
          style={{
            ...baseStyle,
            opacity: disabled ? 0.55 : 1,
            cursor: disabled ? "not-allowed" : "pointer",
          }}
        >
          {label}
        </button>
        {!info.enabled && info.reason && (
          <span style={{ fontSize: 12, color: colors.subText, marginTop: 4 }}>{info.reason}</span>
        )}
      </div>
    );
  };

  return (
    <section
      aria-label="実行制御の操作"
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 8,
        padding: 16,
        marginBottom: 16,
      }}
    >
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        {renderItem("start", "開始", "primary")}
        {renderItem("pause", "一時停止", "default")}
        {renderItem("resume", "再開", "primary")}
      </div>

      <div style={{ marginTop: 24 }}>{renderItem("emergency", "緊急停止", "danger")}</div>

      <div style={{ marginTop: 24 }}>{renderItem("reset", "リセット", "danger")}</div>
    </section>
  );
}
