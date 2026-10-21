// P206 利用量・運用指標：期間の入力と直近 7・14・30 日のボタン（FE 詳細設計 admin_agents_logs 2章・4章）
import { METRICS_MAX_DAYS } from "@nous/shared";
import { useEffect, useId, useState } from "react";
import { FieldError } from "../../shared/FieldError";
import { inputStyle } from "../../shared/fieldStyles";
import { buttonStyle } from "../../shared/Modal";
import { colors } from "../../shared/theme";

const DAY_MS = 86_400_000;
const PRESET_DAYS = [7, 14, 30] as const;

export type PresetDays = (typeof PRESET_DAYS)[number];

/** UTC の今日の日付（YYYY-MM-DD） */
export function todayUtcDate(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** 期間の検証。誤りがあれば日本語のメッセージを返す */
export function validateRange(from: string, to: string): string | null {
  if (!from || !to) return null;
  const fromMs = Date.parse(`${from}T00:00:00.000Z`);
  const toMs = Date.parse(`${to}T00:00:00.000Z`);
  if (Number.isNaN(fromMs) || Number.isNaN(toMs)) return null;
  if (from > to) return "開始日は終了日より前にしてください";
  const days = Math.round((toMs - fromMs) / DAY_MS) + 1;
  if (days > METRICS_MAX_DAYS) return `期間は ${METRICS_MAX_DAYS} 日以内にしてください`;
  return null;
}

/** 直近 N 日（to は UTC の今日、from は to − (days − 1)） */
export function presetRange(days: PresetDays, now: Date = new Date()): { from: string; to: string } {
  const to = todayUtcDate(now);
  const toMs = Date.parse(`${to}T00:00:00.000Z`);
  const fromMs = toMs - (days - 1) * DAY_MS;
  const from = new Date(fromMs).toISOString().slice(0, 10);
  return { from, to };
}

export interface DateRangePickerProps {
  from: string;
  to: string;
  onChange: (next: { from: string; to: string }) => void;
}

export function DateRangePicker({ from, to, onChange }: DateRangePickerProps) {
  const fromId = useId();
  const toId = useId();
  const errorId = useId();
  const [draftFrom, setDraftFrom] = useState(from);
  const [draftTo, setDraftTo] = useState(to);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraftFrom(from);
    setDraftTo(to);
    setError(validateRange(from, to));
  }, [from, to]);

  const applyRange = (nextFrom: string, nextTo: string) => {
    setDraftFrom(nextFrom);
    setDraftTo(nextTo);
    const err = validateRange(nextFrom, nextTo);
    setError(err);
    if (!err && nextFrom && nextTo) {
      onChange({ from: nextFrom, to: nextTo });
    }
  };

  return (
    <div
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 6,
        padding: 16,
        marginBottom: 16,
      }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
        <span style={{ fontWeight: 600 }}>期間</span>
        <label htmlFor={fromId} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span>開始日</span>
          <input
            id={fromId}
            type="date"
            aria-label="期間の開始"
            value={draftFrom}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            onChange={(e) => applyRange(e.target.value, draftTo)}
            style={{ ...inputStyle(Boolean(error)), width: 150 }}
          />
        </label>
        <span>〜</span>
        <label htmlFor={toId} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span>終了日</span>
          <input
            id={toId}
            type="date"
            aria-label="期間の終了"
            value={draftTo}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            onChange={(e) => applyRange(draftFrom, e.target.value)}
            style={{ ...inputStyle(Boolean(error)), width: 150 }}
          />
        </label>
        <div style={{ display: "flex", gap: 8 }}>
          {PRESET_DAYS.map((days) => (
            <button
              key={days}
              type="button"
              onClick={() => {
                const next = presetRange(days);
                applyRange(next.from, next.to);
              }}
              style={buttonStyle}
            >
              直近 {days} 日
            </button>
          ))}
        </div>
        <span style={{ color: colors.subText, fontSize: 13 }}>日本時間 9:00 に切り替わります</span>
      </div>
      <FieldError id={errorId} message={error} />
    </div>
  );
}
