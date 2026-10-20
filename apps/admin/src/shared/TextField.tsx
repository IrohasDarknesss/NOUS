// 文字数つきの入力（P201・P204・P209・P210 も使う）
import { useId } from "react";
import { FieldError } from "./FieldError";
import { inputStyle, labelStyle } from "./fieldStyles";
import { colors } from "./theme";

export interface TextFieldProps {
  label: string;
  value: string;
  maxLength: number;
  error?: string | null;
  multiline?: boolean;
  rows?: number;
  type?: "text" | "password";
  placeholder?: string;
  disabled?: boolean;
  autoComplete?: string;
  /** 文字数の表示を出さない（パスワードなど） */
  hideCount?: boolean;
  onChange: (value: string) => void;
}

export function TextField({
  label,
  value,
  maxLength,
  error,
  multiline = false,
  rows = 3,
  type = "text",
  placeholder,
  disabled,
  autoComplete,
  hideCount = false,
  onChange,
}: TextFieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const common = {
    id,
    value,
    placeholder,
    disabled,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": error ? errorId : undefined,
    style: inputStyle(Boolean(error)),
  } as const;
  const count = [...value].length;

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <label htmlFor={id} style={labelStyle}>
          {label}
        </label>
        {!hideCount && (
          <span style={{ fontSize: 13, color: count > maxLength ? colors.danger : colors.subText }}>
            {count}/{maxLength}
          </span>
        )}
      </div>
      {multiline ? (
        <textarea {...common} rows={rows} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input {...common} type={type} autoComplete={autoComplete} onChange={(e) => onChange(e.target.value)} />
      )}
      <FieldError id={errorId} message={error} />
    </div>
  );
}
