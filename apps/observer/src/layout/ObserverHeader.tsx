import { Link } from "react-router-dom";
import { colors, contentMaxWidth } from "../lib/theme";

interface Props {
  /** true ならサービス名をリンクにせず、「このサービスについて」も出さない（P106） */
  linkDisabled?: boolean;
}

export function ObserverHeader({ linkDisabled = false }: Props) {
  const brand = { fontSize: 20, fontWeight: 700, color: colors.text, textDecoration: "none" } as const;
  return (
    <header style={{ background: colors.surface, borderBottom: `1px solid ${colors.border}` }}>
      <div
        style={{
          maxWidth: contentMaxWidth,
          margin: "0 auto",
          padding: "12px 16px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        {linkDisabled ? (
          <span style={brand}>NOUS</span>
        ) : (
          <Link to="/" style={brand}>
            NOUS
          </Link>
        )}
        {!linkDisabled && (
          <Link to="/about" style={{ color: colors.primary, fontSize: 14 }}>
            このサービスについて
          </Link>
        )}
      </div>
    </header>
  );
}
