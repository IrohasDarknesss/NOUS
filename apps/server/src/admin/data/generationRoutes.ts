// 生成ログのルート（BE 詳細設計 admin_data 2章、NOUS-65）
// 読み取りだけ：DB を書き換えない。監査ログも残さない。
import { EventIdParamsSchema, GenerationListQuerySchema } from "@nous/shared";
import { Hono } from "hono";
import { findCurrentWorld } from "../../world/worldService";
import type { AdminEnv } from "../context";
import { getGenerationDetail, listGenerationsForWorld } from "../generations/generationQueryService";

export const generationRoutes = new Hono<AdminEnv>();

// 7. GET /admin/api/generations
generationRoutes.get("/generations", (c) => {
  const query = GenerationListQuerySchema.parse(c.req.query());
  const world = findCurrentWorld(c.var.db);
  if (!world) {
    return c.json({ items: [], nextCursor: null }, 200);
  }
  const res = listGenerationsForWorld(c.var.db, world.world_id, query);
  return c.json(res, 200);
});

// 8. GET /admin/api/generations/:eventId
generationRoutes.get("/generations/:eventId", (c) => {
  const { eventId } = EventIdParamsSchema.parse({ eventId: c.req.param("eventId") });
  const res = getGenerationDetail(c.var.db, c.var.logger, eventId);
  return c.json(res, 200);
});
