// 選択
import { useId } from "react";
import { FieldError } from "./FieldError";
import { inputStyle, labelStyle } from "./fieldStyles";

export interface SelectOption<V extends string = string> {
  value: V;
  label: string;
}

export interface SelectFieldProps<V extends string = string> {
  label: string;
  options: readonly SelectOption<V>[];
  value: V;
  error?: string | null;
  disabled?: boolean;
  onChange: (value: V) => void;
}

export function SelectField<V extends string = string>({
  label,
  options,
  value,
  error,
  disabled,
  onChange,
}: SelectFieldProps<V>) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div style={{ marginBottom: 16 }}>
      <label htmlFor={id} style={labelStyle}>
        {label}
      </label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={(e) => onChange(e.target.value as V)}
        style={inputStyle(Boolean(error))}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <FieldError id={errorId} message={error} />
    </div>
  );
}
