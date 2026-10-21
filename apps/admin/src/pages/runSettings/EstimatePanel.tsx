// P205 見込みの枠（EstimatePanel）。画面基本設計書 P205 H01〜H03、FE 詳細設計 admin_control 2章。
import { colors } from "../../shared/theme";
import type { Estimate } from "./estimate";

export interface EstimatePanelProps {
  estimate: Estimate;
}

export function EstimatePanel({ estimate }: EstimatePanelProps) {
  return (
    <section
      aria-label="生成量の見込み"
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 8,
        padding: 16,
        marginBottom: 16,
      }}
    >
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 16 }}>
        <div>
          <div style={{ fontSize: 12, color: colors.subText, marginBottom: 4 }}>1回の平均 Neurons</div>
          <div style={{ fontWeight: 700 }}>{estimate.avgNeuronsPerRun.toFixed(1)} Neurons</div>
        </div>
        <div>
          <div style={{ fontSize: 12, color: colors.subText, marginBottom: 4 }}>1巡の見込み</div>
          <div style={{ fontWeight: 700 }}>約 {estimate.neuronsPerCycle.toLocaleString()} Neurons</div>
        </div>
        <div>
          <div style={{ fontSize: 12, color: colors.subText, marginBottom: 4 }}>1日の見込み</div>
          <div style={{ fontWeight: 700 }}>
            約 {estimate.dailyNeurons.toLocaleString()} Neurons・約 {estimate.dailyRuns.toLocaleString()} 回
          </div>
        </div>
        <div>
          <div style={{ fontSize: 12, color: colors.subText, marginBottom: 4 }}>周期の下限</div>
          <div style={{ fontWeight: 700 }}>約 {estimate.cycleMinutesFloor} 分</div>
        </div>
      </div>
    </section>
  );
}
