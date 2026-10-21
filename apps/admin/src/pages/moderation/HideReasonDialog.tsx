// P209 非表示・取り消しの理由の入力ダイアログ
import { HIDE_REASON_MAX, type AdminPostItem } from "@nous/shared";
import { useState, type FormEvent } from "react";
import { buttonStyle, dangerButtonStyle, Modal, primaryButtonStyle } from "../../shared/Modal";
import { TextField } from "../../shared/TextField";
import { colors } from "../../shared/theme";
import type { FieldErrors } from "../../shared/useApiErrorHandler";

export interface HideReasonDialogProps {
  mode: "hide" | "unhide";
  post: AdminPostItem;
  onConfirm: (reason?: string) => Promise<FieldErrors | void> | void;
  onCancel: () => void;
}

export const HIDE_REASON_TOO_LONG_MESSAGE = `${HIDE_REASON_MAX} 字以内で入力してください`;

export function HideReasonDialog({ mode, post, onConfirm, onCancel }: HideReasonDialogProps) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const confirmHide = async (e?: FormEvent) => {
    e?.preventDefault();
    if (submitting) return;
    if ([...reason].length > HIDE_REASON_MAX) {
      setError(HIDE_REASON_TOO_LONG_MESSAGE);
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const fields = await onConfirm(reason.length > 0 ? reason : undefined);
      if (fields) {
        const msg = fields.reason ?? fields._form;
        if (msg) setError(msg);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const isHide = mode === "hide";
  const title = isHide ? "投稿を非表示にする" : "非表示を取り消す";
  const confirmLabel = isHide ? "非表示にする" : "取り消す";

  return (
    <Modal labelledBy="hide-reason-dialog-title">
      <form onSubmit={(e) => void confirmHide(e)}>
        <h2 id="hide-reason-dialog-title" style={{ fontSize: 18, margin: "0 0 12px" }}>
          {title}
        </h2>
        <div
          style={{
            marginBottom: 12,
            padding: "8px 12px",
            background: colors.background,
            borderRadius: 4,
            fontSize: 13,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{post.agent.displayName}</div>
          <div>{post.body}</div>
        </div>
        <TextField
          label="理由"
          value={reason}
          maxLength={HIDE_REASON_MAX}
          multiline
          rows={3}
          error={error}
          disabled={submitting}
          onChange={(v) => {
            setReason(v);
            if (error && [...v].length <= HIDE_REASON_MAX) setError(null);
          }}
        />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" onClick={onCancel} disabled={submitting} style={buttonStyle}>
            キャンセル
          </button>
          <button type="submit" disabled={submitting} style={isHide ? dangerButtonStyle : primaryButtonStyle}>
            {submitting ? "送信中…" : confirmLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}
