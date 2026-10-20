// P208 生成ログ詳細：入力と出力の全文（等幅、入力は折りたたみ）（FE 詳細設計 admin_agents_logs 2章・3章、画面基本設計書 P208 4章）
import { useState } from "react";
import { buttonStyle } from "../../shared/Modal";
import { colors } from "../../shared/theme";

export interface PromptViewerProps {
  promptText: string | null;
  outputText: string | null;
}

const preStyle = {
  margin: 0,
  padding: 12,
  background: "#F8FAFC",
  border: `1px solid ${colors.border}`,
  borderRadius: 4,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Courier New", monospace',
  fontSize: 13,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  overflowX: "auto",
} as const;

export function PromptViewer({ promptText, outputText }: PromptViewerProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <section
      aria-label="入力と出力の全文"
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 6,
        padding: 16,
        marginBottom: 16,
      }}
    >
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <h2 style={{ fontSize: 15, margin: 0 }}>入力の全文</h2>
          {promptText !== null && (
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => setExpanded((prev) => !prev)}
              style={buttonStyle}
            >
              {expanded ? "入力の全文を閉じる" : "入力の全文を開く"}
            </button>
          )}
        </div>
        {promptText === null ? (
          <p style={{ margin: 0, color: colors.subText }}>なし（LLM を呼んでいません）</p>
        ) : expanded ? (
          <pre data-testid="prompt-text" style={preStyle}>
            {promptText}
          </pre>
        ) : (
          <p style={{ margin: 0, color: colors.subText }}>折りたたんでいます（{[...promptText].length} 字）</p>
        )}
      </div>

      <div>
        <h2 style={{ fontSize: 15, margin: "0 0 8px" }}>出力の全文</h2>
        {outputText === null ? (
          <p style={{ margin: 0, color: colors.subText }}>なし</p>
        ) : (
          <pre data-testid="output-text" style={preStyle}>
            {outputText}
          </pre>
        )}
      </div>
    </section>
  );
}
