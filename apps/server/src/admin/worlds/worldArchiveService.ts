// 世界のアーカイブの参照（BE 詳細設計 admin_data 2章・3章・4章、NOUS-65）
// 読み取りだけ：DB を書き換えない。
import {
  WorldPageQuerySchema,
  type AdminPostItem,
  type WorldGenerationsResponse,
  type WorldItem,
  type WorldListResponse,
  type WorldPageQuery,
  type WorldPostsResponse,
} from "@nous/shared";
import { and, count, desc, eq, sql, type SQL } from "drizzle-orm";
import type { Clock } from "../../clock/clock";
import { agents, posts, worlds } from "../../db/schema";
import type { DbOrTx } from "../../db/tx";
import { encodeCursor } from "../../lib/cursor";
import { AppError } from "../../lib/errors";
import { getWorldTimeSec } from "../../world/worldTime";
import { decodePairCursor, listGenerationsForWorld } from "../generations/generationQueryService";
import { zodFields } from "../middleware/errorHandler";

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
 * 指定した世界の投稿を非表示も含めて (world_time_sec, post_id) の新しい順に limit+1 件読む。
 * NOUS-66 の searchPosts がまだないため、ここで同じ形の一覧取得を担う
 */
export function listWorldPosts(db: DbOrTx, worldId: string, page: WorldPageQuery = {}): WorldPostsResponse {
  const parsed = WorldPageQuerySchema.safeParse(page);
  if (!parsed.success) {
    throw new AppError("VALIDATION_ERROR", { fields: zodFields(parsed.error) });
  }

  const { cursor, limit } = parsed.data;
  const conditions: SQL[] = [eq(posts.world_id, worldId)];

  if (cursor !== undefined) {
    const [timeSecStr, postId] = decodePairCursor(cursor);
    const timeSec = Number(timeSecStr);
    if (Number.isNaN(timeSec)) {
      throw new AppError("VALIDATION_ERROR", { fields: { cursor: "カーソルが正しくありません" } });
    }
    conditions.push(sql`(${posts.world_time_sec}, ${posts.post_id}) < (${timeSec}, ${postId})`);
  }

  const rows = db
    .select({
      postId: posts.post_id,
      body: posts.body,
      visibility: posts.visibility,
      worldTimeSec: posts.world_time_sec,
      createdAt: posts.created_at,
      agentId: agents.agent_id,
      displayName: agents.display_name,
      replyToPostId: posts.reply_to_post_id,
      generationEventId: posts.generation_event_id,
    })
    .from(posts)
    .innerJoin(agents, eq(agents.agent_id, posts.agent_id))
    .where(and(...conditions))
    .orderBy(desc(posts.world_time_sec), desc(posts.post_id))
    .limit(limit + 1)
    .all();

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const last = pageRows[pageRows.length - 1];

  const items: AdminPostItem[] = pageRows.map((r) => ({
    postId: r.postId,
    body: r.body,
    visibility: r.visibility,
    worldTimeSec: r.worldTimeSec,
    createdAt: r.createdAt,
    agent: { agentId: r.agentId, displayName: r.displayName },
    replyToPostId: r.replyToPostId,
    generationEventId: r.generationEventId,
  }));

  return {
    items,
    nextCursor: hasMore && last ? encodeCursor([String(last.worldTimeSec), last.postId]) : null,
  };
}

/**
 * 4章 getArchivePosts：世界が存在するか確かめ（なければ 404 WORLD_NOT_FOUND）、その世界の投稿一覧を返す
 */
export function getArchivePosts(db: DbOrTx, worldId: string, page: WorldPageQuery = {}): WorldPostsResponse {
  const world = db.select({ world_id: worlds.world_id }).from(worlds).where(eq(worlds.world_id, worldId)).get();
  if (!world) {
    throw new AppError("WORLD_NOT_FOUND");
  }
  return listWorldPosts(db, worldId, page);
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
