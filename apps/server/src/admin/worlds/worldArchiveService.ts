// 世界のアーカイブの参照（BE 詳細設計 admin_data 2章・3章・4章、NOUS-65・NOUS-85）
// 読み取りだけ：DB を書き換えない。
import {
  WorldPageQuerySchema,
  type WorldGenerationsResponse,
  type WorldItem,
  type WorldListResponse,
  type WorldPageQuery,
  type WorldPostsResponse,
} from "@nous/shared";
import { count, desc, eq } from "drizzle-orm";
import type { Clock } from "../../clock/clock";
import { agents, posts, worlds } from "../../db/schema";
import type { DbOrTx } from "../../db/tx";
import { AppError } from "../../lib/errors";
import { getWorldTimeSec } from "../../world/worldTime";
import { listGenerationsForWorld } from "../generations/generationQueryService";
import { zodFields } from "../middleware/errorHandler";
import { searchPosts } from "../moderation/postQueryService";

/**
 * 4章 listWorldSummaries：すべての世界を created_at の新しい順に読み、各世界の agentCount・postCount を
 * GROUP BY で1回ずつ数え、世界内時間を計算して返す（archived は確定した値）
 */
export function listWorldSummaries(db: DbOrTx, clock: Clock): WorldListResponse {
  const worldRows = db.select().from(worlds).orderBy(desc(worlds.created_at)).all();

  const agentCountRows = db
    .select({ world_id: agents.world_id, n: count() })
    .from(agents)
    .groupBy(agents.world_id)
    .all();
  const agentCountMap = new Map(agentCountRows.map((r) => [r.world_id, r.n]));

  const postCountRows = db.select({ world_id: posts.world_id, n: count() }).from(posts).groupBy(posts.world_id).all();
  const postCountMap = new Map(postCountRows.map((r) => [r.world_id, r.n]));

  const now = clock.now();
  const items: WorldItem[] = worldRows.map((w) => ({
    worldId: w.world_id,
    name: w.name,
    state: w.state,
    createdAt: w.created_at,
    startedAt: w.started_at,
    archivedAt: w.archived_at,
    worldTimeSec: getWorldTimeSec(w, now),
    agentCount: agentCountMap.get(w.world_id) ?? 0,
    postCount: postCountMap.get(w.world_id) ?? 0,
  }));

  return { items };
}

/**
 * 4章 getArchivePosts：世界が存在するか確かめ（なければ 404 WORLD_NOT_FOUND）、
 * page を WorldPageQuerySchema で検証して searchPosts を呼び出す（q・visibility は指定しない）
 */
export function getArchivePosts(db: DbOrTx, worldId: string, page: WorldPageQuery = {}): WorldPostsResponse {
  const world = db.select({ world_id: worlds.world_id }).from(worlds).where(eq(worlds.world_id, worldId)).get();
  if (!world) {
    throw new AppError("WORLD_NOT_FOUND");
  }
  const parsed = WorldPageQuerySchema.safeParse(page);
  if (!parsed.success) {
    throw new AppError("VALIDATION_ERROR", { fields: zodFields(parsed.error) });
  }
  const { cursor, limit } = parsed.data;
  return searchPosts(db, worldId, { cursor, limit });
}

/**
 * 4章 getArchiveGenerations：世界が存在するか確かめ（なければ 404 WORLD_NOT_FOUND）、その世界の生成イベント一覧を返す
 */
export function getArchiveGenerations(
  db: DbOrTx,
  worldId: string,
  query: WorldPageQuery = {},
): WorldGenerationsResponse {
  const world = db.select({ world_id: worlds.world_id }).from(worlds).where(eq(worlds.world_id, worldId)).get();
  if (!world) {
    throw new AppError("WORLD_NOT_FOUND");
  }
  return listGenerationsForWorld(db, worldId, query);
}
