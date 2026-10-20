// 管理 API の要求の検証（AgentInputSchema・SettingsSchema 以外）。BE 詳細設計 admin_auth・world・admin_data 2章。
import { z } from "zod";
import {
  ACTIONS,
  ADMIN_PASSWORD_LENGTH,
  AUDIT_OPERATIONS,
  GENERATION_STATUSES,
  HIDE_REASON_MAX,
  INVITATION_LABEL_MAX,
  METRICS_MAX_DAYS,
  POST_SEARCH_QUERY_MAX,
  VISIBILITIES,
} from "../constants.js";
import {
  AdminLimitSchema,
  AdminPageQuerySchema,
  CursorSchema,
  IdSchema,
  IsoDateTimeSchema,
  UsageDateSchema,
} from "./common.js";

const DAY_MS = 86_400_000;

// ---- 認証・招待・監査 ----

/** POST /admin/api/login（前後の空白は除かない） */
export const LoginRequestSchema = z.object({
  password: z.string().min(ADMIN_PASSWORD_LENGTH.min).max(ADMIN_PASSWORD_LENGTH.max),
});

/** POST /admin/api/invitations（前後の空白を除いて 1〜30 字） */
export const InvitationCreateRequestSchema = z.object({
  label: z.string().trim().min(1).max(INVITATION_LABEL_MAX),
});

/** GET /admin/api/audit-logs */
export const AuditLogQuerySchema = AdminPageQuerySchema.extend({
  operation: z.enum(AUDIT_OPERATIONS).optional(),
});

// ---- 世界 ----

/** POST /admin/api/world/reset。名前との一致はサーバーで確かめる（CONFIRM_MISMATCH） */
export const WorldResetRequestSchema = z.object({
  confirmName: z.string().min(1),
});

// ---- 生成ログ ----

/** GET /admin/api/generations（from ≦ to） */
export const GenerationListQuerySchema = AdminPageQuerySchema.extend({
  agentId: IdSchema.optional(),
  action: z.enum(ACTIONS).optional(),
  status: z.enum(GENERATION_STATUSES).optional(),
  from: IsoDateTimeSchema.optional(),
  to: IsoDateTimeSchema.optional(),
}).refine((q) => q.from === undefined || q.to === undefined || Date.parse(q.from) <= Date.parse(q.to), {
  message: "開始は終了より前にしてください",
  path: ["to"],
});

// ---- 投稿の検索と非表示 ----

/** GET /admin/api/posts */
export const PostSearchQuerySchema = z.object({
  q: z.string().min(1).max(POST_SEARCH_QUERY_MAX).optional(),
  visibility: z.enum(VISIBILITIES).optional(),
  agentId: IdSchema.optional(),
  postId: IdSchema.optional(),
  cursor: CursorSchema.optional(),
  limit: AdminLimitSchema,
});

/** POST /admin/api/posts/:postId/hide・unhide の本文（非表示の理由。任意、200 字まで） */
export const HideRequestSchema = z.object({
  reason: z.string().max(HIDE_REASON_MAX).optional(),
});
export type HideRequest = z.input<typeof HideRequestSchema>;

/** GET /admin/api/hide-records */
export const HideRecordQuerySchema = AdminPageQuerySchema;

// ---- 指標 ----

/** GET /admin/api/metrics/daily（from ≦ to、期間は 90 日まで。省略時の既定はサーバーが今日から決める） */
export const MetricsQuerySchema = z
  .object({
    from: UsageDateSchema.optional(),
    to: UsageDateSchema.optional(),
  })
  .superRefine((q, ctx) => {
    if (q.from === undefined || q.to === undefined) return;
    const days = (Date.parse(q.to) - Date.parse(q.from)) / DAY_MS + 1;
    if (days < 1) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "開始は終了より前にしてください", path: ["to"] });
    } else if (days > METRICS_MAX_DAYS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `期間は ${METRICS_MAX_DAYS} 日以内にしてください`,
        path: ["to"],
      });
    }
  });

// ---- アーカイブ ----

/** GET /admin/api/worlds/:worldId/posts・generations */
export const WorldPageQuerySchema = AdminPageQuerySchema;

// ---- パスのパラメータ ----

export const AgentIdParamsSchema = z.object({ agentId: IdSchema });
export const PostIdParamsSchema = z.object({ postId: IdSchema });
export const EventIdParamsSchema = z.object({ eventId: IdSchema });
export const InvitationIdParamsSchema = z.object({ invitationId: IdSchema });
export const WorldIdParamsSchema = z.object({ worldId: IdSchema });
