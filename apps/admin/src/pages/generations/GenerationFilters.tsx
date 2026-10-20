// P207 生成ログ一覧：絞り込み（エージェント・行動・状態・期間・実行 ID）（FE 詳細設計 admin_agents_logs 2章・4章・6章）
import { ACTIONS, GENERATION_STATUSES, type Action, type AdminAgentRef, type GenerationStatus } from "@nous/shared";
import { useEffect, useId, useState, type FormEvent } from "react";
import type { GenerationFiltersValue } from "../../api/generations";
import { FieldError } from "../../shared/FieldError";
import { inputStyle, labelStyle } from "../../shared/fieldStyles";
import { buttonStyle, primaryButtonStyle } from "../../shared/Modal";
import { SelectField, type SelectOption } from "../../shared/SelectField";
import { colors } from "../../shared/theme";
import { STATUS_LABELS } from "./StatusBadge";

const JST_OFFSET_MS = 9 * 3_600_000;
export const EVENT_ID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;
export const EVENT_ID_ERROR_MESSAGE = "実行 ID は 26 字です";
export const RANGE_ERROR_MESSAGE = "開始は終了より前にしてください";

/** UTC の ISO 8601 を JST の datetime-local の文字列（YYYY-MM-DDTHH:mm）に変える */
export function toLocalDateTime(iso: string | undefined): string {
  if (!iso) return "";
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "";
  const jst = new Date(ms + JST_OFFSET_MS);
  return jst.toISOString().slice(0, 16);
}

/** JST の入力（YYYY-MM-DDTHH:mm または YYYY-MM-DDTHH:mm:ss）を UTC の ISO 8601 に変える */
export function toUtcIso(localValue: string): string {
  const trimmed = localValue.trim();
  if (!trimmed) return "";
  const withSec = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(trimmed) ? `${trimmed}:00` : trimmed;
  const hasOffset = /[Zz]$|[+-]\d{2}:\d{2}$/.test(withSec);
  const d = new Date(hasOffset ? withSec : `${withSec}+09:00`);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString();
}

/** 期間の検証（開始 ≦ 終了） */
export function validateGenerationRange(fromIso: string | undefined, toIso: string | undefined): string | null {
  if (!fromIso || !toIso) return null;
  if (Date.parse(fromIso) > Date.parse(toIso)) return RANGE_ERROR_MESSAGE;
  return null;
}

/** 実行 ID を検証し、正しければ /generations/{id} へ移動する。誤りがあればエラー文言を返す */
export function searchByEventId(eventIdInput: string, navigate: (to: string) => void): string | null {
  const trimmed = eventIdInput.trim();
  if (!EVENT_ID_PATTERN.test(trimmed)) return EVENT_ID_ERROR_MESSAGE;
  navigate(`/generations/${trimmed}`);
  return null;
}

const ACTION_OPTIONS: readonly SelectOption<"" | Action>[] = [
  { value: "", label: "すべて" },
  ...ACTIONS.map((a) => ({ value: a, label: a })),
];

const STATUS_OPTIONS: readonly SelectOption<"" | GenerationStatus>[] = [
  { value: "", label: "すべて" },
  ...GENERATION_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] })),
];

export interface GenerationFiltersProps {
  filters: GenerationFiltersValue;
  agents: readonly AdminAgentRef[];
  onChange: (next: GenerationFiltersValue) => void;
  onSearchId: (eventIdInput: string) => string | null;
}

export function GenerationFilters({ filters, agents, onChange, onSearchId }: GenerationFiltersProps) {
  const fromId = useId();
  const toId = useId();
  const rangeErrorId = useId();
  const eventInputId = useId();
  const eventErrorId = useId();

  const [fromLocal, setFromLocal] = useState(() => toLocalDateTime(filters.from));
  const [toLocal, setToLocal] = useState(() => toLocalDateTime(filters.to));
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [eventIdInput, setEventIdInput] = useState("");
  const [eventIdError, setEventIdError] = useState<string | null>(null);

  useEffect(() => {
    setFromLocal(toLocalDateTime(filters.from));
    setToLocal(toLocalDateTime(filters.to));
    setRangeError(validateGenerationRange(filters.from, filters.to));
  }, [filters.from, filters.to]);

  const agentOptions: readonly SelectOption<string>[] = [
    { value: "", label: "すべて" },
    ...agents.map((a) => ({ value: a.agentId, label: a.displayName })),
  ];

  const handleRangeChange = (nextFromLocal: string, nextToLocal: string) => {
    setFromLocal(nextFromLocal);
    setToLocal(nextToLocal);
    const nextFromIso = nextFromLocal ? toUtcIso(nextFromLocal) : undefined;
    const nextToIso = nextToLocal ? toUtcIso(nextToLocal) : undefined;
    const err = validateGenerationRange(nextFromIso, nextToIso);
    setRangeError(err);
    if (!err) {
      onChange({
        ...filters,
        from: nextFromIso || undefined,
        to: nextToIso || undefined,
      });
    }
  };

  const handleEventIdSubmit = (e: FormEvent) => {
    e.preventDefault();
    const err = onSearchId(eventIdInput);
    setEventIdError(err);
  };

  return (
    <div
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 6,
        padding: 16,
        marginBottom: 16,
      }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-start" }}>
        <div style={{ minWidth: 160 }}>
          <SelectField
            label="エージェント"
            options={agentOptions}
            value={filters.agentId ?? ""}
            onChange={(v) => onChange({ ...filters, agentId: v || undefined })}
          />
        </div>
        <div style={{ minWidth: 140 }}>
          <SelectField
            label="行動"
            options={ACTION_OPTIONS}
            value={filters.action ?? ""}
            onChange={(v) => onChange({ ...filters, action: (v || undefined) as Action | undefined })}
          />
        </div>
        <div style={{ minWidth: 140 }}>
          <SelectField
            label="状態"
            options={STATUS_OPTIONS}
            value={filters.status ?? ""}
            onChange={(v) => onChange({ ...filters, status: (v || undefined) as GenerationStatus | undefined })}
          />
        </div>
        <div>
          <span style={labelStyle}>期間（JST）</span>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input
              id={fromId}
              type="datetime-local"
              aria-label="期間の開始"
              value={fromLocal}
              aria-invalid={rangeError ? true : undefined}
              aria-describedby={rangeError ? rangeErrorId : undefined}
              onChange={(e) => handleRangeChange(e.target.value, toLocal)}
              style={{ ...inputStyle(Boolean(rangeError)), width: 190 }}
            />
            <span>〜</span>
            <input
              id={toId}
              type="datetime-local"
              aria-label="期間の終了"
              value={toLocal}
              aria-invalid={rangeError ? true : undefined}
              aria-describedby={rangeError ? rangeErrorId : undefined}
              onChange={(e) => handleRangeChange(fromLocal, e.target.value)}
              style={{ ...inputStyle(Boolean(rangeError)), width: 190 }}
            />
          </div>
          <FieldError id={rangeErrorId} message={rangeError} />
        </div>
        <form onSubmit={handleEventIdSubmit} style={{ marginLeft: "auto" }}>
          <label htmlFor={eventInputId} style={labelStyle}>
            実行 ID
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              id={eventInputId}
              type="text"
              placeholder="26 字の ULID"
              value={eventIdInput}
              aria-invalid={eventIdError ? true : undefined}
              aria-describedby={eventIdError ? eventErrorId : undefined}
              onChange={(e) => {
                setEventIdInput(e.target.value);
                if (eventIdError) setEventIdError(null);
              }}
              style={{ ...inputStyle(Boolean(eventIdError)), width: 220 }}
            />
            <button type="submit" style={primaryButtonStyle}>
              検索
            </button>
            {(filters.agentId || filters.action || filters.status || filters.from || filters.to) && (
              <button type="button" onClick={() => onChange({})} style={buttonStyle}>
                クリア
              </button>
            )}
          </div>
          <FieldError id={eventErrorId} message={eventIdError} />
        </form>
      </div>
    </div>
  );
}
