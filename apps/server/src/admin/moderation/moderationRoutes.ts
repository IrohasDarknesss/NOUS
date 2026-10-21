// 投稿の検索・非表示・再表示・非表示の履歴のルート 4 本（BE 詳細設計 admin_data 1章・2章、NOUS-66）
// dataRoutes が "/" に登録する。パスは /admin/api からの相対で書く。
// 認証は adminServer で済んでいる（requireAdminSession・requireCsrf は掛かっている）
import { HideRecordQuerySchema, HideRequestSchema, PostIdParamsSchema, PostSearchQuerySchema } from "@nous/shared";
import { Hono, type Context } from "hono";
import { findCurrentWorld } from "../../world/worldService";
import type { AdminEnv } from "../context";
import { hidePost, listHideHistory, unhidePost } from "./moderationService";
import { searchPosts } from "./postQueryService";

export const moderationRoutes = new Hono<AdminEnv>();

/** hide・unhide の本文は任意。本文がない・JSON でない場合は reason 未指定として扱う */
async function parseOptionalJsonBody(c: Context<AdminEnv>): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return {};
  }
}

// 1. GET /admin/api/posts
moderationRoutes.get("/posts", (c) => {
  const query = PostSearchQuerySchema.parse({
    q: c.req.query("q"),
    visibility: c.req.query("visibility"),
    agentId: c.req.query("agentId"),
    postId: c.req.query("postId"),
    cursor: c.req.query("cursor"),
    limit: c.req.query("limit"),
  });
  const world = findCurrentWorld(c.var.db);
  if (!world) {
    return c.json({ items: [], nextCursor: null }, 200);
  }
  const res = searchPosts(c.var.db, world.world_id, query);
  return c.json(res, 200);
});

// 2. POST /admin/api/posts/:postId/hide
moderationRoutes.post("/posts/:postId/hide", async (c) => {
  const { postId } = PostIdParamsSchema.parse({ postId: c.req.param("postId") });
  const { reason } = HideRequestSchema.parse(await parseOptionalJsonBody(c));
  const res = hidePost(c.var.db, c.var.clock, postId, reason, c.var.admin);
  return c.json(res, 200);
});

// 3. POST /admin/api/posts/:postId/unhide
moderationRoutes.post("/posts/:postId/unhide", async (c) => {
  const { postId } = PostIdParamsSchema.parse({ postId: c.req.param("postId") });
  const { reason } = HideRequestSchema.parse(await parseOptionalJsonBody(c));
  const res = unhidePost(c.var.db, c.var.clock, postId, reason, c.var.admin);
  return c.json(res, 200);
});

// 4. GET /admin/api/hide-records
moderationRoutes.get("/hide-records", (c) => {
  const query = HideRecordQuerySchema.parse({
    cursor: c.req.query("cursor"),
    limit: c.req.query("limit"),
  });
  const res = listHideHistory(c.var.db, query);
  return c.json(res, 200);
});
