// P202 世界の状態の枠（WorldStatusCard）。画面基本設計書 P202 H01〜H06、FE 詳細設計 admin_control 2章。
import type { AdminWorld } from "@nous/shared";
import { formatStopReason, WorldStateBadge } from "../../layout/WorldStateBadge";
import { colors } from "../../shared/theme";

export interface WorldStatusCardProps {
  world: AdminWorld;
}

export function formatNextCycleAt(iso: string | null): string {
  if (!iso) return "―";
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "―";
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(ms));
}

export function WorldStatusCard({ world }: WorldStatusCardProps) {
  const stopReasonText = world.stopReason ? formatStopReason(world.stopReason) : "―";
  const nextCycleText = world.state === "running" ? formatNextCycleAt(world.nextCycleAt) : "―";

  return (
    <section
      aria-label="世界の状態"
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 8,
        padding: 16,
        marginBottom: 16,
      }}
    >
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 16 }}>
        <div>
          <div style={{ fontSize: 12, color: colors.subText, marginBottom: 4 }}>世界の名前</div>
          <div style={{ fontWeight: 700, fontSize: 16 }}>{world.name}</div>
        </div>
        <div>
          <div style={{ fontSize: 12, color: colors.subText, marginBottom: 4 }}>状態</div>
          <div>
            <WorldStateBadge state={world.state} stopReason={world.stopReason} />
          </div>
        </div>
        <div>
          <div style={{ fontSize: 12, color: colors.subText, marginBottom: 4 }}>停止理由</div>
          <div>{stopReasonText}</div>
        </div>
        <div>
          <div style={{ fontSize: 12, color: colors.subText, marginBottom: 4 }}>巡の番号</div>
          <div>第 {world.cycleNo} 巡</div>
        </div>
        <div>
          <div style={{ fontSize: 12, color: colors.subText, marginBottom: 4 }}>次の巡の予定（JST）</div>
          <div>{nextCycleText}</div>
        </div>
        <div>
          <div style={{ fontSize: 12, color: colors.subText, marginBottom: 4 }}>エージェントの数</div>
          <div>
            稼働 {world.agentCounts.active} 体・停止 {world.agentCounts.stopped} 体
          </div>
        </div>
      </div>
    </section>
  );
}
