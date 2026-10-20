// 範囲つきの数値の入力。値は文字列のまま返し、検証は呼び出し側で行う（空欄・小数も検証の対象にするため）
import { useId } from "react";
import { FieldError } from "./FieldError";
import { inputStyle, labelStyle } from "./fieldStyles";
import { colors } from "./theme";

export interface NumberFieldProps {
  label: string;
  value: number | string;
  min: number;
  max: number;
  unit?: string;
  error?: string | null;
  disabled?: boolean;
  onChange: (value: string) => void;
}

export function NumberField({ label, value, min, max, unit, error, disabled, onChange }: NumberFieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div style={{ marginBottom: 16 }}>
      <label htmlFor={id} style={labelStyle}>
        {label}
      </label>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <input
          id={id}
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          step={1}
          value={value}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          onChange={(e) => onChange(e.target.value)}
          style={{ ...inputStyle(Boolean(error)), width: 160 }}
        />
        {unit && <span>{unit}</span>}
        <span style={{ color: colors.subText, fontSize: 13 }}>
          {min}〜{max}
        </span>
      </div>
      <FieldError id={errorId} message={error} />
    </div>
  );
}
