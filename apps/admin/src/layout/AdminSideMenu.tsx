// サイドメニュー（8 項目、240px）。現在のパスを強調する
import { NavLink } from "react-router-dom";
import { colors } from "../shared/theme";

export const ADMIN_MENU_ITEMS = [
  { to: "/", label: "実行制御", end: true },
  { to: "/agents", label: "エージェント", end: false },
  { to: "/settings", label: "実行設定", end: false },
  { to: "/metrics", label: "利用量と運用指標", end: false },
  { to: "/generations", label: "生成ログ", end: false },
  { to: "/moderation", label: "非表示管理", end: false },
  { to: "/invitations", label: "閲覧アクセス", end: false },
  { to: "/worlds", label: "世界のアーカイブ", end: false },
] as const;

export function AdminSideMenu() {
  return (
    <nav
      aria-label="管理メニュー"
      style={{ width: 240, flexShrink: 0, background: colors.sideMenu, color: colors.sideMenuText, paddingTop: 16 }}
    >
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {ADMIN_MENU_ITEMS.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              end={item.end}
              style={({ isActive }) => ({
                display: "block",
                padding: "10px 20px",
                color: isActive ? "#FFFFFF" : colors.sideMenuText,
                background: isActive ? colors.sideMenuActive : "transparent",
                borderLeft: `4px solid ${isActive ? colors.primary : "transparent"}`,
                fontWeight: isActive ? 700 : 400,
                textDecoration: "none",
              })}
            >
              {item.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
