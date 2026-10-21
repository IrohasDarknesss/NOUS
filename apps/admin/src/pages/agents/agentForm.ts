// P204 フォームの型・初期値・検証（packages/shared の AgentInputSchema を使う）
// FE 詳細設計 admin_agents_logs 1章・3章・4章・6章、画面基本設計書 P204 4章・6章
import {
  AGENT_LIMITS,
  AgentInputSchema,
  DEFAULT_ACTIVITY_LEVEL,
  type AdminAgentItem,
  type AgentInputRequest,
} from "@nous/shared";
import type { FieldErrors } from "../../shared/useApiErrorHandler";

export interface AgentForm {
  handle: string;
  displayName: string;
  bio: string;
  interests: string;
  topics: string;
  personality: string;
  valuesText: string;
  stance: string;
  activityLevel: number;
  noRealPersonConfirmed: boolean;
}

export type AgentFormField = keyof AgentForm;

export const AGENT_VALIDATION_MESSAGES = {
  required: "入力してください",
  handleFormat: "3〜20 字の半角英数字と _ で入力してください",
  handleTaken: "このハンドルは使われています",
  displayNameMax: "30 字以内で入力してください",
  bioMax: "200 字以内で入力してください",
  attributeMax: "100 字以内で入力してください",
  activityLevel: "1〜5 から選んでください",
  noRealPersonConfirmed: "確認の欄を選んでください",
} as const;

export function createInitialAgentForm(agent?: Partial<AgentForm>): AgentForm {
  return {
    handle: agent?.handle ?? "",
    displayName: agent?.displayName ?? "",
    bio: agent?.bio ?? "",
    interests: agent?.interests ?? "",
    topics: agent?.topics ?? "",
    personality: agent?.personality ?? "",
    valuesText: agent?.valuesText ?? "",
    stance: agent?.stance ?? "",
    activityLevel: agent?.activityLevel ?? DEFAULT_ACTIVITY_LEVEL,
    noRealPersonConfirmed: agent?.noRealPersonConfirmed ?? false,
  };
}

export function agentItemToForm(item: AdminAgentItem & Partial<AgentForm>): AgentForm {
  return createInitialAgentForm({
    handle: item.handle,
    displayName: item.displayName,
    bio: item.bio ?? "",
    interests: item.interests ?? "",
    topics: item.topics ?? "",
    personality: item.personality ?? "",
    valuesText: item.valuesText ?? "",
    stance: item.stance ?? "",
    activityLevel: item.activityLevel,
    noRealPersonConfirmed: false,
  });
}

export function toAgentInputRequest(form: AgentForm): AgentInputRequest {
  return {
    handle: form.handle,
    displayName: form.displayName,
    bio: form.bio,
    interests: form.interests,
    topics: form.topics,
    personality: form.personality,
    valuesText: form.valuesText,
    stance: form.stance,
    activityLevel: form.activityLevel,
    noRealPersonConfirmed: form.noRealPersonConfirmed as true,
  };
}

/**
 * AgentInputSchema.safeParse を使い、失敗を項目ごとの日本語（設計書 6章・P204 の文言）に変える
 */
export function validateAgentForm(form: AgentForm): FieldErrors {
  const parsed = AgentInputSchema.safeParse(form);
  if (parsed.success) return {};

  const errors: FieldErrors = {};

  for (const issue of parsed.error.issues) {
    const field = String(issue.path[0] ?? "") as AgentFormField;
    if (!field || errors[field]) continue;

    switch (field) {
      case "handle": {
        const trimmed = form.handle.trim();
        errors.handle =
          trimmed.length === 0 ? AGENT_VALIDATION_MESSAGES.required : AGENT_VALIDATION_MESSAGES.handleFormat;
        break;
      }
      case "displayName": {
        const trimmed = form.displayName.trim();
        errors.displayName =
          trimmed.length === 0 ? AGENT_VALIDATION_MESSAGES.required : AGENT_VALIDATION_MESSAGES.displayNameMax;
        break;
      }
      case "bio": {
        errors.bio = AGENT_VALIDATION_MESSAGES.bioMax;
        break;
      }
      case "interests":
      case "topics":
      case "personality":
      case "valuesText":
      case "stance": {
        const trimmed = form[field].trim();
        errors[field] =
          trimmed.length === 0 ? AGENT_VALIDATION_MESSAGES.required : AGENT_VALIDATION_MESSAGES.attributeMax;
        break;
      }
      case "activityLevel": {
        errors.activityLevel = AGENT_VALIDATION_MESSAGES.activityLevel;
        break;
      }
      case "noRealPersonConfirmed": {
        errors.noRealPersonConfirmed = AGENT_VALIDATION_MESSAGES.noRealPersonConfirmed;
        break;
      }
    }
  }

  return errors;
}

/** 単一の欄だけを検証する（Blur 時） */
export function validateAgentField(form: AgentForm, field: AgentFormField): string | undefined {
  const all = validateAgentForm(form);
  return all[field];
}

export { AGENT_LIMITS };
