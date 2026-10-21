// 投稿の検索（BE 詳細設計 admin_data 2章 GET /admin/api/posts・3章 searchPosts・4章 searchPosts）
// 世界のアーカイブ（GET /admin/api/worlds/:worldId/posts）からも worldId を渡して使う
import type { AdminPostItem, PostSearchResponse, Visibility } from "@nous/shared";
import { and, desc, eq, lt, or, sql, type SQL } from "drizzle-orm";
import { agents, posts } from "../../db/schema";
import type { DbOrTx } from "../../db/tx";
import { decodeCursor, encodeCursor } from "../../lib/cursor";
import { AppError } from "../../lib/errors";
import { LIKE_ESCAPE_CHAR, likeContains } from "../../lib/sql";

/** searchPosts の検索条件（検証は呼び出し元で済んでいる。cursor の中身はここで確かめる） */
export interface SearchPostsFilters {
  q?: string;
  visibility?: Visibility;
  agentId?: string;
  postId?: string;
  cursor?: string;
  limit: number;
}

/** カーソルの不正は 400 VALIDATION_ERROR（fields.cursor） */
function invalidCursor(): AppError {
  return new AppError("VALIDATION_ERROR", { fields: { cursor: "カーソルが正しくありません" } });
}

/** カーソル（[world_time_sec, post_id]）を復号する。2 要素でない・world_time_sec が整数でないなら 400 */
function decodePostCursor(cursor: string): { worldTimeSec: number; postId: string } {
  const values = decodeCursor(cursor);
  const [rawTime, postId] = values;
  if (values.length !== 2 || rawTime === undefined || postId === undefined || postId === "") {
    throw invalidCursor();
  }
  if (!/^\d+$/.test(rawTime)) {
    throw invalidCursor();
  }
  const worldTimeSec = Number(rawTime);
  if (!Number.isSafeInteger(worldTimeSec)) {
    throw invalidCursor();
  }
  return { worldTimeSec, postId };
}

/**
 * 4章 searchPosts：指定した世界の投稿を、新しい順（world_time_sec DESC, post_id DESC）に limit 件まで返す。
 * 投稿者は agents との JOIN で付ける。q は本文の部分一致（LIKE の特殊文字は escapeLike で逃がす）。
 * limit+1 件読み、あまりがあれば最後に返す行から nextCursor を作る
 */
export function searchPosts(db: DbOrTx, worldId: string, filters: SearchPostsFilters): PostSearchResponse {
  const { q, visibility, agentId, postId, cursor, limit } = filters;

  const conditions: SQL[] = [eq(posts.world_id, worldId)];
  if (visibility !== undefined) {
    conditions.push(eq(posts.visibility, visibility));
  }
  if (agentId !== undefined) {
    conditions.push(eq(posts.agent_id, agentId));
  }
  if (postId !== undefined) {
    conditions.push(eq(posts.post_id, postId));
  }
  if (q !== undefined) {
    conditions.push(sql`${posts.body} LIKE ${likeContains(q)} ESCAPE ${LIKE_ESCAPE_CHAR}`);
  }
  if (cursor !== undefined) {
    const c = decodePostCursor(cursor);
    const older = or(
      lt(posts.world_time_sec, c.worldTimeSec),
      and(eq(posts.world_time_sec, c.worldTimeSec), lt(posts.post_id, c.postId)),
    );
    if (older) {
      conditions.push(older);
    }
  }

  const rows = db
    .select({
      post_id: posts.post_id,
      body: posts.body,
      visibility: posts.visibility,
      world_time_sec: posts.world_time_sec,
      created_at: posts.created_at,
      reply_to_post_id: posts.reply_to_post_id,
      generation_event_id: posts.generation_event_id,
      agent_id: agents.agent_id,
      display_name: agents.display_name,
    })
    .from(posts)
    .innerJoin(agents, eq(posts.agent_id, agents.agent_id))
    .where(and(...conditions))
    .orderBy(desc(posts.world_time_sec), desc(posts.post_id))
    .limit(limit + 1)
    .all();

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];

  const items: AdminPostItem[] = page.map((row) => ({
    postId: row.post_id,
    body: row.body,
    visibility: row.visibility,
    worldTimeSec: row.world_time_sec,
    createdAt: row.created_at,
    agent: { agentId: row.agent_id, displayName: row.display_name },
    replyToPostId: row.reply_to_post_id,
    generationEventId: row.generation_event_id,
  }));

  return {
    items,
    nextCursor: hasMore && last ? encodeCursor([String(last.world_time_sec), last.post_id]) : null,
  };
}
