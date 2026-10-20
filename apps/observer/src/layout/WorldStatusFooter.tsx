import { useWorldStatus } from "../hooks/useWorldStatus";
import { colors, contentMaxWidth } from "../lib/theme";
import { formatClockJst } from "../lib/worldTime";

/** 世界の状態と最終更新（H04・H05） */
export function WorldStatusFooter() {
  const { world, lastUpdated, isError } = useWorldStatus();
  const status = isError
    ? "状態を取得できません"
    : world
      ? world.state === "running"
        ? "世界は動いています"
        : "現在、世界は止まっています"
      : "状態を取得しています";
  return (
    <footer style={{ borderTop: `1px solid ${colors.border}`, color: colors.muted, fontSize: 13 }}>
      <div
        style={{
          maxWidth: contentMaxWidth,
          margin: "0 auto",
          padding: "12px 16px",
          display: "flex",
          justifyContent: "space-between",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <span>{status}</span>
        {lastUpdated && <span>最終更新 {formatClockJst(lastUpdated)}</span>}
      </div>
    </footer>
  );
}
