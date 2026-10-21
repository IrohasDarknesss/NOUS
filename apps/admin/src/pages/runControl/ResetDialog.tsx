// P202 リセットのダイアログ（ResetDialog）。画面基本設計書 P202 H17・E08・6章、FE 詳細設計 admin_control 2章・4章。
import { WORLD_NAME_MAX } from "@nous/shared";
import { useState, type FormEvent } from "react";
import { buttonStyle, dangerButtonStyle, Modal } from "../../shared/Modal";
import { TextField } from "../../shared/TextField";

export const RESET_NAME_MISMATCH_MESSAGE = "世界の名前が一致しません";

export interface ResetDialogProps {
  worldName: string;
  onConfirm: (confirmName: string) => void | Promise<void | string | null>;
  onCancel: () => void;
}

export function ResetDialog({ worldName, onConfirm, onCancel }: ResetDialogProps) {
  const [confirmName, setConfirmName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submitReset = async (e?: FormEvent) => {
    e?.preventDefault();
    if (submitting) return;
    if (confirmName !== worldName) {
      setError(RESET_NAME_MISMATCH_MESSAGE);
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const maybeError = await onConfirm(confirmName);
      if (typeof maybeError === "string" && maybeError) {
        setError(maybeError);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal labelledBy="reset-dialog-title">
      <h2 id="reset-dialog-title" style={{ fontSize: 18, margin: "0 0 12px" }}>
        世界のリセット
      </h2>
      <p style={{ margin: "0 0 16px" }}>
        現在の世界「{worldName}
        」をアーカイブにし、同じエージェントと設定で新しい世界を作ります。確認のため、世界の名前を入力してください。
      </p>
      <form onSubmit={(e) => void submitReset(e)} noValidate>
        <TextField
          label="世界の名前"
          value={confirmName}
          maxLength={WORLD_NAME_MAX}
          error={error}
          disabled={submitting}
          hideCount
          onChange={(next) => {
            setConfirmName(next);
            if (error) setError(null);
          }}
        />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" onClick={onCancel} disabled={submitting} style={buttonStyle}>
            キャンセル
          </button>
          <button type="submit" disabled={submitting} style={dangerButtonStyle}>
            {submitting ? "送信中…" : "リセットする"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
