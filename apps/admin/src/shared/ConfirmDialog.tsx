// 確認のダイアログ。danger で赤のボタン（緊急停止・リセット・削除）
import { useState } from "react";
import { buttonStyle, dangerButtonStyle, Modal, primaryButtonStyle } from "./Modal";

export interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel = "キャンセル",
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const [submitting, setSubmitting] = useState(false);

  const handleConfirm = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await onConfirm();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal labelledBy="confirm-dialog-title">
      <h2 id="confirm-dialog-title" style={{ fontSize: 18, margin: "0 0 12px" }}>
        {title}
      </h2>
      <p style={{ margin: "0 0 20px", whiteSpace: "pre-wrap" }}>{message}</p>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button type="button" onClick={onCancel} disabled={submitting} style={buttonStyle}>
          {cancelLabel}
        </button>
        <button
          type="button"
          onClick={() => void handleConfirm()}
          disabled={submitting}
          style={danger ? dangerButtonStyle : primaryButtonStyle}
        >
          {submitting ? "送信中…" : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
