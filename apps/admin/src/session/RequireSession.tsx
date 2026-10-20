// ログインしていなければ /login?next=… へ（パスワード未設定のときも /login で案内を出す）
import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { colors } from "../shared/theme";
import { useSession } from "./SessionProvider";

export function loginPathFor(pathname: string, search: string): string {
  const next = `${pathname}${search}`;
  return next === "/" ? "/login" : `/login?next=${encodeURIComponent(next)}`;
}

export function RequireSession({ children }: { children: ReactNode }) {
  const { status } = useSession();
  const location = useLocation();

  if (status === "loading") {
    return <p style={{ padding: 24, color: colors.subText }}>読み込み中…</p>;
  }
  if (status !== "ready") {
    return <Navigate to={loginPathFor(location.pathname, location.search)} replace />;
  }
  return <>{children}</>;
}
