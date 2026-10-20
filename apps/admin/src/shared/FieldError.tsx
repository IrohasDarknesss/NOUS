// 様式④：入力欄の直下の赤文字
import { colors } from "./theme";

export interface FieldErrorProps {
  message?: string | null;
  id?: string;
}

export function FieldError({ message, id }: FieldErrorProps) {
  if (!message) return null;
  return (
    <p id={id} role="alert" style={{ color: colors.danger, fontSize: 13, margin: "4px 0 0" }}>
      {message}
    </p>
  );
}
