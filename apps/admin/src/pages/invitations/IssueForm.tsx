// P210 表示名の入力と招待リンクの発行フォーム
import { INVITATION_LABEL_MAX } from "@nous/shared";
import { useState, type FormEvent } from "react";
import { primaryButtonStyle } from "../../shared/Modal";
import { TextField } from "../../shared/TextField";
import { colors } from "../../shared/theme";
import type { FieldErrors } from "../../shared/useApiErrorHandler";

export interface IssueFormProps {
  onIssue: (label: string) => Promise<FieldErrors | void>;
  submitting?: boolean;
}

export const LABEL_VALIDATION_MESSAGE = `1〜${INVITATION_LABEL_MAX} 字で入力してください`;

export function IssueForm({ onIssue, submitting = false }: IssueFormProps) {
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [internalSubmitting, setInternalSubmitting] = useState(false);

  const isBusy = submitting || internalSubmitting;

  const submitIssue = async (e?: FormEvent) => {
    e?.preventDefault();
    if (isBusy) return;
    const trimmed = label.trim();
    const len = [...trimmed].length;
    if (len < 1 || len > INVITATION_LABEL_MAX) {
      setError(LABEL_VALIDATION_MESSAGE);
      return;
    }
    setError(null);
    setInternalSubmitting(true);
    try {
      const fields = await onIssue(trimmed);
      if (fields) {
        const msg = fields.label ?? fields._form;
        if (msg) setError(msg);
        return;
      }
      setLabel("");
    } finally {
      setInternalSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={(e) => void submitIssue(e)}
      style={{
        display: "grid",
        gridTemplateColumns: "1fr auto",
        gap: 12,
        alignItems: "start",
        background: colors.surface,
        padding: 16,
        borderRadius: 8,
        border: `1px solid ${colors.border}`,
        marginBottom: 16,
      }}
    >
      <TextField
        label="表示名"
        value={label}
        maxLength={INVITATION_LABEL_MAX}
        error={error}
        disabled={isBusy}
        placeholder="呼び名（氏名・メールアドレスは入れないでください）"
        onChange={(v) => {
          setLabel(v);
          const trimmedLen = [...v.trim()].length;
          if (error && trimmedLen >= 1 && trimmedLen <= INVITATION_LABEL_MAX) {
            setError(null);
          }
        }}
      />
      <div style={{ paddingTop: 22 }}>
        <button type="submit" disabled={isBusy} style={primaryButtonStyle}>
          {isBusy ? "発行中…" : "招待リンクを発行"}
        </button>
      </div>
    </form>
  );
}
