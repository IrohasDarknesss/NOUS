// P205 上限の注意（LimitWarning）。画面基本設計書 P205 H15、FE 詳細設計 admin_control 2章。
import { colors } from "../../shared/theme";
import type { Estimate } from "./estimate";

export const LIMIT_WARNING_MESSAGE =
  "1日の見込みが Neurons の日次上限を超えます。周期を長くするか、活動量を下げてください";

export interface LimitWarningProps {
  estimate: Estimate;
  limit?: number;
}

export function LimitWarning({ estimate }: LimitWarningProps) {
  if (!estimate.overLimit) return null;
  return (
    <div
      role="status"
      aria-label="上限の注意"
      style={{
        background: "#FEF9C3",
        border: `1px solid ${colors.warning}`,
        color: colors.text,
        borderRadius: 8,
        padding: "12px 16px",
        marginBottom: 16,
        fontWeight: 600,
      }}
    >
      {LIMIT_WARNING_MESSAGE}
    </div>
  );
}
