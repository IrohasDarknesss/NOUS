// P208 生成ログ詳細：行動の候補・属性・記憶・参照した投稿の表（FE 詳細設計 admin_agents_logs 2章、画面基本設計書 P208 4章）
import type { GenerationEventDetail, JsonValue, RefPost } from "@nous/shared";
import { DataTable, type DataTableColumn } from "../../shared/DataTable";
import { colors } from "../../shared/theme";

const ATTRIBUTE_LABELS: Record<string, string> = {
  handle: "ハンドル",
  displayName: "表示名",
  bio: "自己紹介",
  interests: "興味",
  topics: "関心分野",
  personality: "性格",
  valuesText: "価値観",
  stance: "主張傾向",
  activityLevel: "活動頻度",
};

const MEMORY_KIND_LABELS: Record<string, string> = {
  interest_profile: "興味・関心の要約",
  recent_posts: "最近の自分の投稿",
  relationship_summary: "関係の要約",
  conversation_summary: "会話の要約",
};

function formatJsonValue(value: JsonValue | undefined): string {
  if (value === null || value === undefined) return "―";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

interface AttributeRow {
  key: string;
  label: string;
  value: string;
}

interface MemoryRow {
  key: string;
  kind: string;
  content: string;
}

function toMemoryRows(memories: readonly JsonValue[]): MemoryRow[] {
  return memories.map((m, idx) => {
    if (typeof m === "object" && m !== null && !Array.isArray(m)) {
      const rec = m as Record<string, JsonValue>;
      const rawKind = typeof rec.kind === "string" ? rec.kind : typeof rec.type === "string" ? rec.type : `#${idx + 1}`;
      const kind = MEMORY_KIND_LABELS[rawKind] ?? rawKind;
      const content =
        typeof rec.content === "string"
          ? rec.content
          : typeof rec.text === "string"
            ? rec.text
            : typeof rec.summary === "string"
              ? rec.summary
              : JSON.stringify(m);
      return { key: `${idx}-${rawKind}`, kind, content };
    }
    return { key: String(idx), kind: `#${idx + 1}`, content: formatJsonValue(m) };
  });
}

export interface InputSectionProps {
  event: GenerationEventDetail;
  refPosts: readonly RefPost[];
}

export function InputSection({ event, refPosts }: InputSectionProps) {
  const attrRows: AttributeRow[] = Object.entries(event.inputAttributes ?? {}).map(([key, value]) => ({
    key,
    label: ATTRIBUTE_LABELS[key] ?? key,
    value: formatJsonValue(value),
  }));

  const memoryRows = toMemoryRows(event.inputMemories ?? []);

  const attrColumns: readonly DataTableColumn<AttributeRow>[] = [
    { key: "label", header: "項目", width: 180, render: (r) => r.label },
    { key: "value", header: "値", render: (r) => r.value },
  ];

  const memoryColumns: readonly DataTableColumn<MemoryRow>[] = [
    { key: "kind", header: "種類", width: 200, render: (r) => r.kind },
    { key: "content", header: "内容", render: (r) => r.content },
  ];

  const refPostColumns: readonly DataTableColumn<RefPost>[] = [
    { key: "label", header: "番号", width: 80, render: (r) => r.label },
    {
      key: "postId",
      header: "投稿 ID",
      width: 240,
      render: (r) => <code style={{ fontFamily: "monospace" }}>{r.postId}</code>,
    },
    { key: "excerpt", header: "本文（先頭 40 字）", render: (r) => r.excerpt },
  ];

  return (
    <section
      aria-label="入力の内容"
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 6,
        padding: 16,
        marginBottom: 16,
      }}
    >
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 15, margin: "0 0 8px" }}>行動の候補</h2>
        <div>
          {event.actionCandidates && event.actionCandidates.length > 0 ? event.actionCandidates.join("・") : "なし"}
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 15, margin: "0 0 8px" }}>入力に用いた属性</h2>
        <DataTable columns={attrColumns} rows={attrRows} rowKey={(r) => r.key} emptyMessage="属性はありません" />
      </div>

      {event.decidedBy === "llm" && (
        <>
          <div style={{ marginBottom: 16 }}>
            <h2 style={{ fontSize: 15, margin: "0 0 8px" }}>入力に用いた記憶</h2>
            <DataTable
              columns={memoryColumns}
              rows={memoryRows}
              rowKey={(r) => r.key}
              emptyMessage="記憶はありません"
            />
          </div>

          <div>
            <h2 style={{ fontSize: 15, margin: "0 0 8px" }}>参照した投稿</h2>
            <DataTable
              columns={refPostColumns}
              rows={refPosts}
              rowKey={(r) => `${r.label}-${r.postId}`}
              emptyMessage="参照した投稿はありません"
            />
          </div>
        </>
      )}
    </section>
  );
}
