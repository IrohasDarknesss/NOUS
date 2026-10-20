// P202 利用量の枠（UsageCard）。画面基本設計書 P202 H07〜H11、FE 詳細設計 admin_control 2章・4章。
import type { UsageView } from "@nous/shared";
import { colors } from "../../shared/theme";

export type UsageLevel = "normal" | "warning" | "danger";

export function usageLevel(used: number, limit: number): UsageLevel {
  if (limit <= 0) return "danger";
  const ratio = used / limit;
  if (ratio >= 1) return "danger";
  if (ratio >= 0.8) return "warning";
  return "normal";
}

function barColor(level: UsageLevel): string {
  if (level === "danger") return colors.danger;
  if (level === "warning") return colors.warning;
  return colors.primary;
}

function progressPercent(used: number, limit: number): number {
  if (limit <= 0) return 100;
  return Math.min(100, Math.max(0, (used / limit) * 100));
}

export interface UsageCardProps {
  usage: UsageView;
  runningGenerations?: number;
}

export function UsageCard({ usage, runningGenerations = 0 }: UsageCardProps) {
  const neuronsLevel = usageLevel(usage.neurons, usage.neuronsLimit);
  const runsLevel = usageLevel(usage.runs, usage.runsLimit);

  return (
    <section
      aria-label="利用日の利用量"
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 8,
        padding: 16,
        marginBottom: 16,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div>
          <span style={{ fontWeight: 600 }}>利用日：{usage.usageDate}（UTC）</span>
          <span style={{ marginLeft: 12, fontSize: 13, color: colors.subText }}>
            次のリセット 09:00（JST）／ 00:00 UTC
          </span>
        </div>
        <div style={{ display: "flex", gap: 16, fontSize: 13 }}>
          <span>実行中 {runningGenerations}</span>
          <span>概算費用：0 円</span>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 16 }}>
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, fontSize: 13 }}>
            <span style={{ fontWeight: 600 }}>Neurons</span>
            <span>
              使用 {usage.neurons.toLocaleString()} / 上限 {usage.neuronsLimit.toLocaleString()}（無料枠{" "}
              {usage.freeTierNeurons.toLocaleString()}）
            </span>
          </div>
          <div style={{ height: 10, background: "#E2E8F0", borderRadius: 5, overflow: "hidden" }}>
            <div
              data-testid="neurons-bar"
              data-level={neuronsLevel}
              style={{
                width: `${progressPercent(usage.neurons, usage.neuronsLimit)}%`,
                height: "100%",
                background: barColor(neuronsLevel),
              }}
            />
          </div>
        </div>

        <div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, fontSize: 13 }}>
            <span style={{ fontWeight: 600 }}>生成の回数</span>
            <span>
              {usage.runs.toLocaleString()} / 上限 {usage.runsLimit.toLocaleString()} 回
            </span>
          </div>
          <div style={{ height: 10, background: "#E2E8F0", borderRadius: 5, overflow: "hidden" }}>
            <div
              data-testid="runs-bar"
              data-level={runsLevel}
              style={{
                width: `${progressPercent(usage.runs, usage.runsLimit)}%`,
                height: "100%",
                background: barColor(runsLevel),
              }}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
