// P210 発行した招待リンク（一度だけ表示）とコピー・注意書き
import { useEffect, useRef, useState } from "react";
import { inputStyle } from "../../shared/fieldStyles";
import { buttonStyle } from "../../shared/Modal";
import { colors } from "../../shared/theme";

export interface IssuedLinkBoxProps {
  url: string;
}

export const COPY_FEEDBACK_MS = 2000;
export const ISSUED_LINK_NOTE = "このリンクは今だけ表示されます。招待する人に直接渡してください";

export function IssuedLinkBox({ url }: IssuedLinkBoxProps) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, []);

  const selectFallbackInput = () => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  };

  const copyInviteUrl = async () => {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      try {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        if (timerRef.current !== null) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
          timerRef.current = null;
          setCopied(false);
        }, COPY_FEEDBACK_MS);
        return;
      } catch {
        selectFallbackInput();
        return;
      }
    }
    selectFallbackInput();
  };

  return (
    <div
      style={{
        background: "#FEF9C3",
        border: `1px solid ${colors.warning}`,
        borderRadius: 8,
        padding: 16,
        marginBottom: 16,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
        <code
          style={{
            fontFamily: "monospace",
            fontSize: 13,
            wordBreak: "break-all",
          }}
        >
          {url}
        </code>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <input
          ref={inputRef}
          type="text"
          readOnly
          aria-label="発行した招待リンク"
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          style={{ ...inputStyle(false), fontFamily: "monospace", flex: 1 }}
        />
        <button type="button" onClick={() => void copyInviteUrl()} style={buttonStyle}>
          コピー
        </button>
        {copied && (
          <span role="status" style={{ color: colors.success, fontWeight: 600, fontSize: 13 }}>
            コピーしました
          </span>
        )}
      </div>
      <p style={{ margin: 0, color: colors.text, fontSize: 13 }}>{ISSUED_LINK_NOTE}</p>
    </div>
  );
}
