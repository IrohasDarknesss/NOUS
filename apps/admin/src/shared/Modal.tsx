// ErrorModal・ConfirmDialog が使うモーダルの枠
import type { ReactNode } from "react";
import { colors } from "./theme";

export interface ModalProps {
  labelledBy: string;
  children: ReactNode;
}

export function Modal({ labelledBy, children }: ModalProps) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, 0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        style={{
          background: colors.surface,
          color: colors.text,
          borderRadius: 8,
          padding: 24,
          width: 440,
          maxWidth: "calc(100vw - 32px)",
          boxShadow: "0 10px 30px rgba(15, 23, 42, 0.3)",
        }}
      >
        {children}
      </div>
    </div>
  );
}

export const buttonStyle = {
  padding: "8px 16px",
  borderRadius: 6,
  border: `1px solid ${colors.border}`,
  background: colors.surface,
  color: colors.text,
  cursor: "pointer",
  fontSize: 14,
} as const;

export const primaryButtonStyle = {
  ...buttonStyle,
  border: `1px solid ${colors.primary}`,
  background: colors.primary,
  color: "#FFFFFF",
} as const;

export const dangerButtonStyle = {
  ...buttonStyle,
  border: `1px solid ${colors.danger}`,
  background: colors.danger,
  color: "#FFFFFF",
} as const;
