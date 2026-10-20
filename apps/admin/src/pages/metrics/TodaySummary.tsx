// P206 利用量・運用指標：今日の Neurons・呼び出し・概算費用 0 円（FE 詳細設計 admin_agents_logs 2章）
import { FREE_TIER_NEURONS, type DailyMetricsItem } from "@nous/shared";
import { colors } from "../../shared/theme";

export interface TodaySummaryProps {
  today: DailyMetricsItem | null | undefined;
  freeTier?: number;
}

export function TodaySummary({ today, freeTier = FREE_TIER_NEURONS }: TodaySummaryProps) {
  const neurons = today ? today.neurons.toLocaleString("ja-JP", { maximumFractionDigits: 1 }) : "0";
  const calls = today ? today.calls.toLocaleString("ja-JP") : "0";
  const freeTierText = freeTier.toLocaleString("ja-JP");

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 24,
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 6,
        padding: "12px 16px",
        marginBottom: 16,
      }}
    >
      <div>
        <span style={{ color: colors.subText, marginRight: 8 }}>今日の Neurons</span>
        <strong data-testid="today-neurons">
          {neurons} / {freeTierText}
        </strong>
      </div>
      <div>
        <span style={{ color: colors.subText, marginRight: 8 }}>今日の呼び出し回数</span>
        <strong data-testid="today-calls">{calls} 回</strong>
      </div>
      <div>
        <span style={{ color: colors.subText, marginRight: 8 }}>概算費用</span>
        <strong data-testid="today-cost">0 円</strong>
      </div>
    </div>
  );
}
