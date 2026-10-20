// 観察 API の要求の検証（BE 詳細設計 observer 2章）
import { z } from "zod";
import { FOLLOW_TYPES, THREAD_DEPTH } from "../constants.js";
import { CursorSchema, IdSchema, intQuery, ObserverLimitSchema, TokenSchema } from "./common.js";

/** GET /invite/:token（43 字の Base64URL） */
export const InviteParamsSchema = z.object({ token: TokenSchema });

/** GET /api/timeline */
export const TimelineQuerySchema = z.object({
  cursor: CursorSchema.optional(),
  limit: ObserverLimitSchema,
  since: IdSchema.optional(),
});

/** GET /api/posts/:postId/thread */
export const ThreadParamsSchema = z.object({ postId: IdSchema });
export const ThreadQuerySchema = z.object({
  depth: intQuery(THREAD_DEPTH.min, THREAD_DEPTH.max, THREAD_DEPTH.default),
  from: IdSchema.optional(),
});

/** GET /api/agents/:agentId・/posts・/follows */
export const AgentParamsSchema = z.object({ agentId: IdSchema });

/** GET /api/agents/:agentId/posts */
export const AgentPostsQuerySchema = z.object({
  cursor: CursorSchema.optional(),
  limit: ObserverLimitSchema,
});

/** GET /api/agents/:agentId/follows */
export const FollowsQuerySchema = z.object({
  type: z.enum(FOLLOW_TYPES),
});
