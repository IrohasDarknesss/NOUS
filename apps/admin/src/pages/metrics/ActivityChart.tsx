// P206 利用量・運用指標：活発さ（棒）と応答率（線、右の軸 %）（FE 詳細設計 admin_agents_logs 2章）
import type { DailyMetricsItem } from "@nous/shared";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { colors } from "../../shared/theme";

export interface ActivityChartProps {
  items: readonly DailyMetricsItem[];
}

export function ActivityChart({ items }: ActivityChartProps) {
  const data = items.map((d) => ({
    usageDate: d.usageDate,
    posts: d.posts,
    replyRatePercent: d.replyRate === null ? null : Number((d.replyRate * 100).toFixed(1)),
  }));

  return (
    <section
      aria-label="活発さと応答率のグラフ"
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 6,
        padding: 16,
        marginBottom: 16,
      }}
    >
      <h2 style={{ fontSize: 15, margin: "0 0 12px" }}>活発さ（投稿数）と応答率（%）</h2>
      <div style={{ width: "100%", height: 220 }}>
        <ResponsiveContainer width="100%" height={220}>
          <ComposedChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke={colors.border} />
            <XAxis dataKey="usageDate" />
            <YAxis yAxisId="left" />
            <YAxis yAxisId="right" orientation="right" domain={[0, 100]} unit="%" />
            <Tooltip />
            <Legend />
            <Bar yAxisId="left" dataKey="posts" name="投稿数" fill={colors.primary} />
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="replyRatePercent"
              name="応答率（%）"
              stroke={colors.success}
              connectNulls
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
