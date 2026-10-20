// P206 利用量・運用指標：日別の Neurons の棒と無料枠・日次上限の横線（FE 詳細設計 admin_agents_logs 2章）
import { FREE_TIER_NEURONS, type DailyMetricsItem } from "@nous/shared";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { colors } from "../../shared/theme";

export interface UsageChartProps {
  items: readonly DailyMetricsItem[];
  freeTier?: number;
  limit?: number;
}

export function UsageChart({ items, freeTier = FREE_TIER_NEURONS, limit }: UsageChartProps) {
  const data = items.map((d) => ({
    usageDate: d.usageDate,
    neurons: d.neurons,
  }));

  return (
    <section
      aria-label="利用量のグラフ"
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 6,
        padding: 16,
        marginBottom: 16,
      }}
    >
      <h2 style={{ fontSize: 15, margin: "0 0 12px" }}>日別の Neurons（無料枠 {freeTier.toLocaleString("ja-JP")}）</h2>
      <div style={{ width: "100%", height: 220 }}>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke={colors.border} />
            <XAxis dataKey="usageDate" />
            <YAxis domain={[0, Math.max(freeTier, limit ?? 0)]} />
            <Tooltip />
            <Legend />
            <Bar dataKey="neurons" name="Neurons" fill={colors.primary} />
            <ReferenceLine
              y={freeTier}
              stroke={colors.danger}
              strokeDasharray="4 4"
              label={`無料枠 ${freeTier.toLocaleString("ja-JP")}`}
            />
            {limit !== undefined && (
              <ReferenceLine
                y={limit}
                stroke={colors.warning}
                strokeDasharray="4 4"
                label={`日次上限 ${limit.toLocaleString("ja-JP")}`}
              />
            )}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
