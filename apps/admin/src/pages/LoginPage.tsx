// P201 管理ログイン（画面基本設計書 P201、FE 詳細設計 admin_control 2〜6章）
import { ADMIN_PASSWORD_LENGTH } from "@nous/shared";
import { useEffect, useId, useState, type FormEvent } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { ApiError, NetworkError } from "../api/client";
import { useSession } from "../session/SessionProvider";
import { ErrorBanner } from "../shared/ErrorBanner";
import { ErrorModal } from "../shared/ErrorModal";
import { FieldError } from "../shared/FieldError";
import { inputStyle, labelStyle } from "../shared/fieldStyles";
import { buttonStyle, primaryButtonStyle } from "../shared/Modal";
import { colors, fontFamily, fontSizes } from "../shared/theme";

export const ADMIN_NOT_SET_MESSAGE =
  "管理者のパスワードが未設定です。端末で pnpm admin:set-password を実行してください";
export const SESSION_EXPIRED_BANNER_MESSAGE = "ログインの有効期限が切れました";
export const LOGIN_FAILED_MESSAGE = "パスワードが正しくありません";
export const SERVER_CONNECT_ERROR_MESSAGE = "管理サーバーに接続できません。システムが起動しているか確かめてください";

export function validatePassword(password: string): string | null {
  if (password.length === 0) return "パスワードを入力してください";
  const length = [...password].length;
  if (length < ADMIN_PASSWORD_LENGTH.min) return "12 字以上で入力してください";
  if (length > ADMIN_PASSWORD_LENGTH.max) return "128 字以内で入力してください";
  return null;
}

function formatJstHhMm(iso: string): string | null {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(ms));
}

export function extractLockedUntil(error: ApiError): string {
  const fromField = error.fields?.lockedUntil;
  if (fromField) {
    if (/^\d{1,2}:\d{2}$/.test(fromField)) return fromField;
    const formatted = formatJstHhMm(fromField);
    if (formatted) return formatted;
    return fromField;
  }
  const isoMatch = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}[^\s「」]*/.exec(error.message);
  if (isoMatch) {
    const formatted = formatJstHhMm(isoMatch[0]);
    if (formatted) return formatted;
  }
  const timeMatch = /(\d{1,2}:\d{2})/.exec(error.message);
  if (timeMatch?.[1]) return timeMatch[1];
  return "しばらく";
}

function resolveNextPath(rawNext: string | null): string {
  if (!rawNext || !rawNext.startsWith("/") || rawNext.startsWith("//")) return "/";
  return rawNext;
}

export function LoginPage() {
  const { status, bootstrapFailed, signIn } = useSession();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const nextPath = resolveNextPath(searchParams.get("next"));
  const expired = searchParams.get("expired") === "1";

  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lockedUntil, setLockedUntil] = useState<string | null>(null);
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  const [bootstrapModalDismissed, setBootstrapModalDismissed] = useState(false);

  const inputId = useId();
  const errorId = `${inputId}-error`;

  useEffect(() => {
    document.title = "管理ログイン - NOUS";
  }, []);

  if (status === "ready") {
    return <Navigate to={nextPath} replace />;
  }

  const togglePasswordVisible = () => {
    setVisible((prev) => !prev);
  };

  const handlePasswordChange = (next: string) => {
    setPassword(next);
    if ([...next].length > ADMIN_PASSWORD_LENGTH.max) {
      setError("128 字以内で入力してください");
    } else {
      setError(null);
    }
  };

  const submitLogin = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting) return;

    const validationError = validatePassword(password);
    if (validationError) {
      setError(validationError);
      return;
    }

    setError(null);
    setBannerError(null);
    setLockedUntil(null);
    setSubmitting(true);

    try {
      await signIn(password);
      navigate(nextPath, { replace: true });
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.status === 401) {
          setBannerError(LOGIN_FAILED_MESSAGE);
          return;
        }
        if (e.status === 429) {
          const until = extractLockedUntil(e);
          setLockedUntil(until);
          setBannerError(`ログインの試行が続いたため、${until} まで受け付けません`);
          return;
        }
        if (e.status === 409 && e.code === "ADMIN_NOT_SET") {
          setBannerError(ADMIN_NOT_SET_MESSAGE);
          return;
        }
        if (e.status === 400) {
          setError(e.fields?.password ?? e.message);
          return;
        }
        if (e.status >= 500) {
          setModalError(SERVER_CONNECT_ERROR_MESSAGE);
          return;
        }
        setBannerError(e.message);
        return;
      }
      if (e instanceof NetworkError) {
        setModalError(SERVER_CONNECT_ERROR_MESSAGE);
        return;
      }
      setModalError(SERVER_CONNECT_ERROR_MESSAGE);
    } finally {
      setSubmitting(false);
    }
  };

  const activeBanner =
    bannerError ??
    (status === "notSet" ? ADMIN_NOT_SET_MESSAGE : null) ??
    (expired ? SESSION_EXPIRED_BANNER_MESSAGE : null);

  const activeModal = modalError ?? (bootstrapFailed && !bootstrapModalDismissed ? SERVER_CONNECT_ERROR_MESSAGE : null);

  return (
    <div
      style={{
        minHeight: "100vh",
        minWidth: 1024,
        background: colors.background,
        color: colors.text,
        fontFamily,
        fontSize: fontSizes.body,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          width: 400,
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 8,
          padding: 24,
          boxShadow: "0 4px 12px rgba(15, 23, 42, 0.08)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
          <div style={{ fontWeight: 700, color: colors.subText, fontSize: 13 }}>NOUS 管理</div>
          <span style={{ fontSize: 12, color: colors.subText }}>P201</span>
        </div>
        <h1 style={{ fontSize: fontSizes.heading, margin: "0 0 16px" }}>管理ログイン</h1>

        <div style={{ marginBottom: activeBanner ? 16 : 0 }}>
          <ErrorBanner message={activeBanner} onClose={bannerError ? () => setBannerError(null) : undefined} />
        </div>

        <form onSubmit={(e) => void submitLogin(e)} noValidate>
          <div style={{ marginBottom: 16 }}>
            <label htmlFor={inputId} style={labelStyle}>
              パスワード
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                id={inputId}
                type={visible ? "text" : "password"}
                value={password}
                autoComplete="current-password"
                autoFocus
                disabled={submitting}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? errorId : undefined}
                onChange={(e) => handlePasswordChange(e.target.value)}
                style={{ ...inputStyle(Boolean(error)), flex: 1 }}
              />
              <button
                type="button"
                aria-label="パスワードの表示の切り替え"
                aria-pressed={visible}
                onClick={togglePasswordVisible}
                style={{ ...buttonStyle, flexShrink: 0 }}
              >
                {visible ? "非表示" : "表示"}
              </button>
            </div>
            <FieldError id={errorId} message={error} />
          </div>

          <button
            type="submit"
            disabled={submitting}
            data-locked-until={lockedUntil ?? undefined}
            style={{ ...primaryButtonStyle, width: "100%", marginBottom: 16 }}
          >
            {submitting ? "確認中…" : "ログイン"}
          </button>
        </form>

        <p
          style={{
            margin: 0,
            padding: "10px 12px",
            background: "#FEF9C3",
            borderRadius: 6,
            fontSize: 13,
            color: colors.text,
          }}
        >
          この画面は、システムを動かす端末からだけ開けます
        </p>
      </div>

      <ErrorModal
        message={activeModal}
        onClose={() => {
          setModalError(null);
          if (bootstrapFailed) setBootstrapModalDismissed(true);
        }}
      />
    </div>
  );
}
