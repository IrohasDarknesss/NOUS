// P209 投稿の検索フォーム（本文・公開状態・エージェント）
import { POST_SEARCH_QUERY_MAX, type AdminAgentRef, type Id, type Visibility } from "@nous/shared";
import { useEffect, useState, type FormEvent } from "react";
import { primaryButtonStyle } from "../../shared/Modal";
import { SelectField, type SelectOption } from "../../shared/SelectField";
import { TextField } from "../../shared/TextField";
import { colors } from "../../shared/theme";

export interface SearchQuery {
  q?: string;
  visibility?: Visibility;
  agentId?: Id;
  postId?: Id;
}

export interface PostSearchFormProps {
  query: SearchQuery;
  agents: readonly AdminAgentRef[];
  onSearch: (next: SearchQuery) => void;
  fieldError?: string | null;
}

const VISIBILITY_OPTIONS: readonly SelectOption<"" | Visibility>[] = [
  { value: "", label: "すべて" },
  { value: "public", label: "公開" },
  { value: "hidden", label: "非表示" },
];

export const SEARCH_QUERY_TOO_LONG_MESSAGE = `${POST_SEARCH_QUERY_MAX} 字以内で入力してください`;

export function PostSearchForm({ query, agents, onSearch, fieldError }: PostSearchFormProps) {
  const [draft, setDraft] = useState<SearchQuery>(() => ({
    q: query.q ?? "",
    visibility: query.visibility,
    agentId: query.agentId,
  }));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft({
      q: query.q ?? "",
      visibility: query.visibility,
      agentId: query.agentId,
    });
  }, [query.q, query.visibility, query.agentId]);

  const submitSearch = (e?: FormEvent) => {
    e?.preventDefault();
    const qText = draft.q ?? "";
    if ([...qText].length > POST_SEARCH_QUERY_MAX) {
      setError(SEARCH_QUERY_TOO_LONG_MESSAGE);
      return;
    }
    setError(null);
    onSearch({
      q: qText.length > 0 ? qText : undefined,
      visibility: draft.visibility || undefined,
      agentId: draft.agentId || undefined,
    });
  };

  const agentOptions: SelectOption<string>[] = [
    { value: "", label: "すべて" },
    ...agents.map((a) => ({ value: a.agentId, label: a.displayName })),
  ];

  return (
    <form
      onSubmit={submitSearch}
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 180px 220px auto",
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
        label="本文の検索"
        value={draft.q ?? ""}
        maxLength={POST_SEARCH_QUERY_MAX}
        error={error ?? fieldError}
        placeholder="検索語を入力"
        onChange={(v) => {
          setDraft((prev) => ({ ...prev, q: v }));
          if (error && [...v].length <= POST_SEARCH_QUERY_MAX) setError(null);
        }}
      />
      <SelectField<"" | Visibility>
        label="公開状態"
        options={VISIBILITY_OPTIONS}
        value={draft.visibility ?? ""}
        onChange={(v) => setDraft((prev) => ({ ...prev, visibility: v || undefined }))}
      />
      <SelectField<string>
        label="エージェント"
        options={agentOptions}
        value={draft.agentId ?? ""}
        onChange={(v) => setDraft((prev) => ({ ...prev, agentId: v || undefined }))}
      />
      <div style={{ paddingTop: 22 }}>
        <button type="submit" style={primaryButtonStyle}>
          検索
        </button>
      </div>
    </form>
  );
}
