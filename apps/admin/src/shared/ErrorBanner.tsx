// 様式②：画面上部（ヘッダー直下）の赤色バー
import { colors } from "./theme";

export interface ErrorBannerProps {
  message: string | null;
  onClose?: () => void;
}

export function ErrorBanner({ message, onClose }: ErrorBannerProps) {
  if (!message) return null;
  return (
    <div
      role="alert"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 16px",
        background: colors.danger,
        color: "#FFFFFF",
      }}
    >
      <span style={{ flex: 1 }}>{message}</span>
      {onClose && (
        <button
          type="button"
          aria-label="閉じる"
          onClick={onClose}
          style={{ background: "transparent", border: "none", color: "#FFFFFF", cursor: "pointer", fontSize: 16 }}
        >
          ×
        </button>
      )}
    </div>
  );
}
