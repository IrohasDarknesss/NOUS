// 管理セッションと CSRF トークンの Context（FE 詳細設計 admin_control 2章・3章・4章）
import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError } from "../api/client";
import * as sessionApi from "../api/session";
import { setCsrfToken } from "./csrfToken";

export { getCsrfToken } from "./csrfToken";

export interface SessionInfo {
  displayName: string;
  /** GET /admin/api/session で分かる期限。ログイン直後は null */
  expiresAt: string | null;
}

export type SessionStatus = "loading" | "ready" | "unauthenticated" | "notSet";

export interface SessionContextValue {
  session: SessionInfo | null;
  status: SessionStatus;
  /** bootstrapSession が通信の失敗で終わった（P201 で様式①を出す） */
  bootstrapFailed: boolean;
  bootstrapSession: () => Promise<void>;
  /** POST /admin/api/login。成功したら session と CSRF トークンを置く。失敗は ApiError をそのまま投げる */
  signIn: (password: string) => Promise<SessionInfo>;
  /** POST /admin/api/logout。成否にかかわらずセッションを捨てて /login へ */
  signOut: () => Promise<void>;
  /** セッションを捨てる（401 の後など） */
  clearSession: () => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [status, setStatus] = useState<SessionStatus>("loading");
  const [bootstrapFailed, setBootstrapFailed] = useState(false);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const clearSession = useCallback(() => {
    setCsrfToken(null);
    setSession(null);
    setStatus("unauthenticated");
  }, []);

  const bootstrapSession = useCallback(async () => {
    try {
      const res = await sessionApi.getSession();
      setCsrfToken(res.csrfToken);
      setSession({ displayName: res.displayName, expiresAt: res.expiresAt });
      setStatus("ready");
      setBootstrapFailed(false);
    } catch (e) {
      setCsrfToken(null);
      setSession(null);
      if (e instanceof ApiError && e.status === 409 && e.code === "ADMIN_NOT_SET") {
        setStatus("notSet");
        setBootstrapFailed(false);
      } else {
        setStatus("unauthenticated");
        setBootstrapFailed(!(e instanceof ApiError && e.status === 401));
      }
    }
  }, []);

  const signIn = useCallback(async (password: string) => {
    const res = await sessionApi.login(password);
    const info: SessionInfo = { displayName: res.displayName, expiresAt: null };
    setCsrfToken(res.csrfToken);
    setSession(info);
    setStatus("ready");
    setBootstrapFailed(false);
    return info;
  }, []);

  const signOut = useCallback(async () => {
    try {
      await sessionApi.logout();
    } catch {
      // 失敗しても握りつぶして遷移する（FE 詳細設計 admin_control 4章 logout）
    }
    clearSession();
    queryClient.clear();
    navigate("/login", { replace: true });
  }, [clearSession, queryClient, navigate]);

  useEffect(() => {
    void bootstrapSession();
  }, [bootstrapSession]);

  const value = useMemo(
    () => ({ session, status, bootstrapFailed, bootstrapSession, signIn, signOut, clearSession }),
    [session, status, bootstrapFailed, bootstrapSession, signIn, signOut, clearSession],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession は SessionProvider の中で使ってください");
  return value;
}
