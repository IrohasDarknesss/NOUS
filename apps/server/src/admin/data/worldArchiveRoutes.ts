// 世界のアーカイブのルート（BE 詳細設計 admin_data 2章、NOUS-65）
// 読み取りだけ：DB を書き換えない。監査ログも残さない。
import { WorldIdParamsSchema, WorldPageQuerySchema } from "@nous/shared";
import { Hono } from "hono";
import type { AdminEnv } from "../context";
import { getArchiveGenerations, getArchivePosts, listWorldSummaries } from "../worlds/worldArchiveService";

export const worldArchiveRoutes = new Hono<AdminEnv>();

// 14. GET /admin/api/worlds
worldArchiveRoutes.get("/worlds", (c) => {
  const res = listWorldSummaries(c.var.db, c.var.clock);
  return c.json(res, 200);
});

// 15. GET /admin/api/worlds/:worldId/posts
worldArchiveRoutes.get("/worlds/:worldId/posts", (c) => {
  const { worldId } = WorldIdParamsSchema.parse({ worldId: c.req.param("worldId") });
  const query = WorldPageQuerySchema.parse(c.req.query());
  const res = getArchivePosts(c.var.db, worldId, query);
  return c.json(res, 200);
});

// 16. GET /admin/api/worlds/:worldId/generations
worldArchiveRoutes.get("/worlds/:worldId/generations", (c) => {
  const { worldId } = WorldIdParamsSchema.parse({ worldId: c.req.param("worldId") });
  const query = WorldPageQuerySchema.parse(c.req.query());
  const res = getArchiveGenerations(c.var.db, worldId, query);
  return c.json(res, 200);
});
