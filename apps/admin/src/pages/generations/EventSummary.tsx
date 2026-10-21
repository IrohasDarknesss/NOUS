// P208 生成ログ詳細：概要と実行 ID のコピー（FE 詳細設計 admin_agents_logs 2章・3章・4章、画面基本設計書 P208 4章）
import type { GenerationEventDetail } from "@nous/shared";
import { useEffect, useRef, useState } from "react";
import { formatWorldTime } from "../../layout/worldTime";
import { buttonStyle } from "../../shared/Modal";
import { colors } from "../../shared/theme";
import { useToast } from "../../shared/Toast";
import { DECIDED_BY_LABELS } from "./GenerationTable";
import { formatFailureKind, StatusBadge } from "./StatusBadge";

const JST_OFFSET_MS = 9 * 3_600_000;
export const COPY_FEEDBACK_MS = 2000;

/** UTC の ISO 8601 を JST の「YYYY-MM-DD HH:MM:SS」に変える */
export function formatDateTimeJst(iso: string | null | undefined): string {
  if (!iso) return "―";
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  const jst = new Date(ms + JST_OFFSET_MS);
  return `${jst.toISOString().slice(0, 10)} ${jst.toISOString().slice(11, 19)}`;
}

/** 実行 ID をクリップボードに写す。使えなければ要素を選択状態にする */
export async function copyEventId(eventId: string, targetElement?: HTMLElement | null): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(eventId);
      return true;
    }
  } catch {
    // クリップボードが使えないときは下の選択処理に落とす
  }
  if (targetElement && typeof window !== "undefined" && window.getSelection && typeof document !== "undefined") {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(targetElement);
    selection?.removeAllRanges();
    selection?.addRange(range);
  }
  return false;
}

export interface EventSummaryProps {
  event: GenerationEventDetail;
}

export function EventSummary({ event }: EventSummaryProps) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idRef = useRef<HTMLElement | null>(null);
  const { showToast } = useToast();

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleCopy = async () => {
    const ok = await copyEventId(event.eventId, idRef.current);
    setCopied(true);
    if (ok) showToast("コピーしました");
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopied(false), COPY_FEEDBACK_MS);
  };

  const cellLabelStyle = { color: colors.subText, fontSize: 13 } as const;

  return (
    <section
      aria-label="概要"
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 6,
        padding: 16,
        marginBottom: 16,
      }}
    >
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          paddingBottom: 12,
          marginBottom: 12,
          borderBottom: `1px solid ${colors.border}`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: colors.subText }}>実行 ID</span>
          <code ref={idRef} data-testid="event-id" style={{ fontFamily: "monospace", fontWeight: 600 }}>
            {event.eventId}
          </code>
          <button type="button" onClick={() => void handleCopy()} style={buttonStyle}>
            {copied ? "コピー済み" : "コピー"}
          </button>
        </div>
        <div>
          <StatusBadge status={event.status} failureKind={event.failureKind} />
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 12,
        }}
      >
        <div>
          <div style={cellLabelStyle}>エージェント</div>
          <div>
            <strong>{event.agent.displayName}</strong>{" "}
            <span style={{ color: colors.subText }}>@{event.agent.handle}</span>
          </div>
        </div>
        <div>
          <div style={cellLabelStyle}>行動・決め方・失敗の種類</div>
          <div>
            行動：{event.action ?? "―"} ／ 決め方：{DECIDED_BY_LABELS[event.decidedBy]} ／ 失敗の種類：
            {formatFailureKind(event.failureKind)}
          </div>
        </div>
        <div>
          <div style={cellLabelStyle}>巡の番号・乱数の種</div>
          <div>
            巡 {event.cycleNo} ／ 種 {event.cycleSeed}
          </div>
        </div>
        <div>
          <div style={cellLabelStyle}>モデル・プロンプトの版</div>
          <div>
            {event.modelId ?? "―"} ／ 版 {event.promptVersion ?? "―"}（{event.llmMode}）
          </div>
        </div>
        <div>
          <div style={cellLabelStyle}>利用量</div>
          <div>
            入力 {event.promptTokens.toLocaleString("ja-JP")} ／ 出力 {event.completionTokens.toLocaleString("ja-JP")}{" "}
            トークン ・ {event.neurons.toFixed(1)} Neurons ・ 概算費用 0 円
          </div>
        </div>
        <div>
          <div style={cellLabelStyle}>時刻</div>
          <div>
            開始 {formatDateTimeJst(event.startedAt)} ／ 終了 {formatDateTimeJst(event.finishedAt)}（
            {formatWorldTime(event.worldTimeSec)}）
          </div>
        </div>
      </div>
    </section>
  );
}
