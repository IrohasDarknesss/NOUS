// P204 実在の人物・機微な情報を含まないことの確認チェックボックス
// FE 詳細設計 admin_agents_logs 2章・6章、画面基本設計書 P204
import { useId } from "react";
import { FieldError } from "../../shared/FieldError";
import { colors } from "../../shared/theme";

export interface NoRealPersonCheckboxProps {
  checked: boolean;
  error?: string | null;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  onBlur?: () => void;
}

export function NoRealPersonCheckbox({ checked, error, disabled, onChange, onBlur }: NoRealPersonCheckboxProps) {
  const id = useId();
  const errorId = `${id}-error`;

  return (
    <div style={{ marginBottom: 16 }}>
      <label
        htmlFor={id}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 12px",
          background: "#FEF9C3",
          border: `1px solid ${error ? colors.danger : colors.border}`,
          borderRadius: 6,
          cursor: disabled ? "default" : "pointer",
          fontWeight: 600,
        }}
      >
        <input
          id={id}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          onChange={(e) => onChange(e.target.checked)}
          onBlur={onBlur}
        />
        <span>実在の人物・団体や、機微な個人情報を含みません</span>
      </label>
      <FieldError id={errorId} message={error} />
    </div>
  );
}
