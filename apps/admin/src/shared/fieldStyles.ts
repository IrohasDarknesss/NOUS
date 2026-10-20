// NumberField・TextField・SelectField の共通の見た目
import { colors } from "./theme";

export const labelStyle = { display: "block", fontWeight: 600, marginBottom: 4 } as const;

export function inputStyle(hasError: boolean) {
  return {
    width: "100%",
    boxSizing: "border-box",
    padding: "6px 8px",
    fontSize: 14,
    border: `1px solid ${hasError ? colors.danger : colors.border}`,
    borderRadius: 4,
    background: colors.surface,
    color: colors.text,
  } as const;
}
