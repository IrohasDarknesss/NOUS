import { colors } from "../lib/theme";

/** 様式②の赤色バー（ヘッダー直下）。message が null なら何も出さない */
export function ErrorBanner({ message }: { message: string | null }) {
  if (message === null) return null;
  return (
    <div role="alert" style={{ background: colors.error, color: "#FFFFFF", padding: "8px 16px", fontSize: 14 }}>
      {message}
    </div>
  );
}
