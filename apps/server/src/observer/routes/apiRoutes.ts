// /api/*（BE 詳細設計 observer 2章・4章 parseListQuery）
import {
  AgentParamsSchema,
  AgentPostsQuerySchema,
  FollowsQuerySchema,
  ThreadParamsSchema,
  ThreadQuerySchema,
  TimelineQuerySchema,
} from "@nous/shared";
import { Hono } from "hono";
import type { z } from "zod";
import { AppError, type ErrorFields } from "../../lib/errors";
import type { ObserverDeps, ObserverEnv } from "../context";
import { getAgentPosts, getAgentProfile, getFollows } from "../services/agentService";
import { getThread } from "../services/threadService";
import { getTimeline, getWorldForViewer, parsePostCursor, type PostCursor } from "../services/timelineService";

const NO_STORE = "no-store";

/** Zod の検証を行い、失敗したら AppError("VALIDATION_ERROR", { fields }) を投げる */
function parseWithSchema<S extends z.ZodTypeAny>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const fields: ErrorFields = {};
    for (const issue of result.error.issues) {
      const key = issue.path.length > 0 ? String(issue.path[0]) : "_";
      if (!(key in fields)) {
        fields[key] = issue.message;
      }
    }
    throw new AppError("VALIDATION_ERROR", { fields });
  }
  return result.data as z.output<S>;
}

export interface ListQuery {
  cursor?: PostCursor;
  limit: number;
  since?: string;
}

/**
 * タイムライン・過去投稿のクエリ（cursor・limit・since）を検証する（observer 4章 parseListQuery）。
 * allowSince が false のときは AgentPostsQuerySchema で検証する（since は無視される）。
 * since と cursor が両方あるときは since を優先するため cursor の復号は行わない
 */
export function parseListQuery(
  query: Record<string, string | undefined>,
  options: { allowSince?: boolean } = {},
): ListQuery {
  if (options.allowSince === false) {
    const parsed = parseWithSchema(AgentPostsQuerySchema, query);
    const cursor = parsed.cursor !== undefined ? parsePostCursor(parsed.cursor) : undefined;
    return { cursor, limit: parsed.limit };
  }
  const parsed = parseWithSchema(TimelineQuerySchema, query);
  if (parsed.since !== undefined) {
    return { limit: parsed.limit, since: parsed.since };
  }
  const cursor = parsed.cursor !== undefined ? parsePostCursor(parsed.cursor) : undefined;
  return { cursor, limit: parsed.limit };
}

/** /api に登録するルーター。requireViewer は observerServer で前に通す */
export function createApiRoutes(deps: ObserverDeps): Hono<ObserverEnv> {
  const { db, clock } = deps;
  const api = new Hono<ObserverEnv>();

  api.use("*", async (c, next) => {
    await next();
    c.header("Cache-Control", NO_STORE);
  });

  api.get("/world", (c) => {
    return c.json(getWorldForViewer(db, clock));
  });

  api.get("/timeline", (c) => {
    const query = parseListQuery(c.req.query());
    return c.json(getTimeline(db, clock, query));
  });

  api.get("/posts/:postId/thread", (c) => {
    const { postId } = parseWithSchema(ThreadParamsSchema, c.req.param());
    const { depth, from } = parseWithSchema(ThreadQuerySchema, c.req.query());
    return c.json(getThread(db, { postId, depth, from }));
  });

  api.get("/agents/:agentId", (c) => {
    const { agentId } = parseWithSchema(AgentParamsSchema, c.req.param());
    return c.json(getAgentProfile(db, agentId));
  });

  api.get("/agents/:agentId/posts", (c) => {
    const { agentId } = parseWithSchema(AgentParamsSchema, c.req.param());
    const { cursor, limit } = parseListQuery(c.req.query(), { allowSince: false });
    return c.json(getAgentPosts(db, { agentId, cursor, limit }));
  });

  api.get("/agents/:agentId/follows", (c) => {
    const { agentId } = parseWithSchema(AgentParamsSchema, c.req.param());
    const { type } = parseWithSchema(FollowsQuerySchema, c.req.query());
    return c.json(getFollows(db, { agentId, type }));
  });

  return api;
}
