// AgentInputSchema（BE 詳細設計 admin_data 2章・4章、FE 詳細設計 admin_agents_logs）。画面とサーバーで共用する。
import { z } from "zod";
import { AGENT_LIMITS, AGENT_STATES, HANDLE_PATTERN } from "../constants.js";

const attribute = z.string().trim().min(AGENT_LIMITS.attribute.min).max(AGENT_LIMITS.attribute.max);

/** POST /admin/api/agents・PUT /admin/api/agents/:agentId の本文 */
export const AgentInputSchema = z.object({
  handle: z.string().trim().min(AGENT_LIMITS.handle.min).max(AGENT_LIMITS.handle.max).regex(HANDLE_PATTERN),
  displayName: z.string().trim().min(AGENT_LIMITS.displayName.min).max(AGENT_LIMITS.displayName.max),
  bio: z.string().trim().max(AGENT_LIMITS.bio.max).default(""),
  interests: attribute,
  topics: attribute,
  personality: attribute,
  valuesText: attribute,
  stance: attribute,
  activityLevel: z.number().int().min(AGENT_LIMITS.activityLevel.min).max(AGENT_LIMITS.activityLevel.max),
  /** 実在の人物・機微な情報を含まないことの確認（FR-301）。true のみ */
  noRealPersonConfirmed: z.literal(true),
});
/** 検証後の値（bio は既定値 '' が入る） */
export type AgentInput = z.output<typeof AgentInputSchema>;
/** 送る側の値（bio は省略できる） */
export type AgentInputRequest = z.input<typeof AgentInputSchema>;

/** GET /admin/api/agents のクエリ */
export const AgentListQuerySchema = z.object({
  state: z.enum(AGENT_STATES).optional(),
});
