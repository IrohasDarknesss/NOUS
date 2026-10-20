// ヘッダー：左にサービス名と「管理」、中央に世界の状態のバッジと世界内時間、右にログアウト
import { useAdminWorld } from "../api/world";
import { buttonStyle } from "../shared/Modal";
import { colors } from "../shared/theme";
import { useSession } from "../session/SessionProvider";
import { WorldStateBadge } from "./WorldStateBadge";
import { formatWorldTime } from "./worldTime";

export function AdminHeader() {
  const { world } = useAdminWorld();
  const { session, signOut } = useSession();

  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        height: 56,
        padding: "0 24px",
        background: colors.surface,
        borderBottom: `1px solid ${colors.border}`,
      }}
    >
      <div style={{ fontWeight: 700, fontSize: 18 }}>
        NOUS <span style={{ fontWeight: 400, color: colors.subText, fontSize: 14 }}>管理</span>
      </div>
      <div style={{ flex: 1, display: "flex", justifyContent: "center", alignItems: "center", gap: 12 }}>
        {world ? (
          <>
            <WorldStateBadge state={world.state} stopReason={world.stopReason} />
            <span aria-label="世界内時間">{formatWorldTime(world.worldTimeSec)}</span>
          </>
        ) : (
          <span style={{ color: colors.subText }}>状態を取得しています…</span>
        )}
      </div>
      {session && <span style={{ color: colors.subText }}>{session.displayName}</span>}
      <button type="button" onClick={() => void signOut()} style={buttonStyle}>
        ログアウト
      </button>
    </header>
  );
}
