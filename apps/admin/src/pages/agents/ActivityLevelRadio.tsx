// P204 活動頻度（1〜5）のラジオと参加確率の説明
// FE 詳細設計 admin_agents_logs 2章・4章、画面基本設計書 P204
import { FieldError } from "../../shared/FieldError";
import { labelStyle } from "../../shared/fieldStyles";
import { colors } from "../../shared/theme";

export const ACTIVITY_LEVELS = [1, 2, 3, 4, 5] as const;
export type ActivityLevel = (typeof ACTIVITY_LEVELS)[number];

const PARTICIPATION_RATES: Record<number, number> = {
  1: 0.3,
  2: 0.45,
  3: 0.6,
  4: 0.75,
  5: 0.9,
};

/**
 * 活動頻度 1〜5 から参加確率の説明文を返す（IPO 表 participationLabel）
 * 1→30%、2→45%、3→60%、4→75%、5→90%
 */
export function participationLabel(level: number): string {
  const rate = PARTICIPATION_RATES[level] ?? 0.6;
  const percent = Math.round(rate * 100);
  return `行動機会の約 ${percent}% で行動します`;
}

export interface ActivityLevelRadioProps {
  value: number;
  error?: string | null;
  disabled?: boolean;
  onChange: (level: number) => void;
}

export function ActivityLevelRadio({ value, error, disabled, onChange }: ActivityLevelRadioProps) {
  return (
    <fieldset
      style={{
        border: "none",
        padding: 0,
        margin: "0 0 16px",
      }}
    >
      <legend style={labelStyle}>活動頻度</legend>
      <div style={{ display: "flex", gap: 16, alignItems: "center", marginTop: 4 }}>
        {ACTIVITY_LEVELS.map((lvl) => (
          <label
            key={lvl}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              cursor: disabled ? "default" : "pointer",
            }}
          >
            <input
              type="radio"
              name="activityLevel"
              value={lvl}
              checked={value === lvl}
              disabled={disabled}
              onChange={() => onChange(lvl)}
            />
            <span>{lvl}</span>
          </label>
        ))}
        <span style={{ fontSize: 13, color: colors.subText }}>{participationLabel(value)}</span>
      </div>
      <FieldError message={error} />
    </fieldset>
  );
}
