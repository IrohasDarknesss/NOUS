// タイムライン・世界の状態・ページ送りの共通処理（BE 詳細設計 observer 2〜4章 timelineService.ts）
import {
  ID_LENGTH,
  TIMELINE_SINCE_MAX,
  type CurrentWorldState,
  type PostRef,
  type PostView,
  type TimelineResponse,
  type WorldView,
} from "@nous/shared";
import { and, count, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { Clock } from "../../clock/clock";
import { agents, likes, posts } from "../../db/schema";
import type { DbOrTx } from "../../db/tx";
import { decodeCursor, encodeCursor } from "../../lib/cursor";
import { AppError } from "../../lib/errors";
import { findCurrentWorld, type WorldRow } from "../../world/worldService";
import { getWorldTimeSec } from "../../world/worldTime";
import { toPostView, type PostWithAuthorRow } from "../mappers";

/** 投稿一覧のカーソル（world_time_sec と post_id） */
export interface PostCursor {
  worldTimeSec: number;
  postId: string;
}

/** 現在の世界を読む。なければ 404 WORLD_NOT_FOUND */
export function mustGetCurrentWorld(db: DbOrTx): WorldRow {
  const world = findCurrentWorld(db);
  if (!world) throw new AppError("WORLD_NOT_FOUND");
  return world;
}

/**
 * 投稿一覧のカーソルを復号・検証する。
 * decode した結果が 2 要素でない・1 つ目が 0 以上の整数でない・2 つ目が 26 字でない場合は 400 VALIDATION_ERROR（fields.cursor）
 */
export function parsePostCursor(cursor: string): PostCursor {
  const parts = decodeCursor(cursor);
  if (parts.length !== 2) {
    throw new AppError("VALIDATION_ERROR", { fields: { cursor: "カーソルが正しくありません" } });
  }
  const [secStr, postId] = parts as [string, string];
  if (!/^\d+$/.test(secStr) || postId.length !== ID_LENGTH) {
    throw new AppError("VALIDATION_ERROR", { fields: { cursor: "カーソルが正しくありません" } });
  }
  const worldTimeSec = Number(secStr);
  if (!Number.isSafeInteger(worldTimeSec) || worldTimeSec < 0) {
    throw new AppError("VALIDATION_ERROR", { fields: { cursor: "カーソルが正しくありません" } });
  }
  return { worldTimeSec, postId };
}

/** 投稿の行から nextCursor を作る */
export function formatPostCursor(row: { world_time_sec: number; post_id: string }): string {
  return encodeCursor([String(row.world_time_sec), row.post_id]);
}

/** GET /api/world：現在の世界の状態と世界内時間を返す */
export function getWorldForViewer(db: DbOrTx, clock: Clock): WorldView {
  const world = mustGetCurrentWorld(db);
  const state = world.state as CurrentWorldState;
  const worldTimeSec = getWorldTimeSec(world, clock.now());
  return {
    state,
    worldTimeSec,
    isRunning: state === "running",
    updatedAt: clock.nowIso(),
  };
}

/** posts と agents（投稿者）を JOIN して PostWithAuthorRow の配列で読む */
export function queryPostsWithAuthors(db: DbOrTx, where: SQL | undefined, limit: number): PostWithAuthorRow[] {
  const rows = db
    .select({
      post_id: posts.post_id,
      body: posts.body,
      world_time_sec: posts.world_time_sec,
      reply_to_post_id: posts.reply_to_post_id,
      agent_id: agents.agent_id,
      handle: agents.handle,
      display_name: agents.display_name,
      state: agents.state,
    })
    .from(posts)
    .innerJoin(agents, eq(agents.agent_id, posts.agent_id))
    .where(where)
    .orderBy(desc(posts.world_time_sec), desc(posts.post_id))
    .limit(limit)
    .all();

  return rows.map((r) => ({
    post_id: r.post_id,
    body: r.body,
    world_time_sec: r.world_time_sec,
    reply_to_post_id: r.reply_to_post_id,
    agent: {
      agent_id: r.agent_id,
      handle: r.handle,
      display_name: r.display_name,
      state: r.state,
    },
  }));
}

/** 現在の世界の public の投稿を (world_time_sec, post_id) 降順で limit 件読む（selectTimelinePage） */
export function selectTimelinePage(
  db: DbOrTx,
  worldId: string,
  cursor: PostCursor | undefined,
  limit: number,
): PostWithAuthorRow[] {
  const cursorCond = cursor
    ? sql`(${posts.world_time_sec}, ${posts.post_id}) < (${cursor.worldTimeSec}, ${cursor.postId})`
    : undefined;
  return queryPostsWithAuthors(db, and(eq(posts.world_id, worldId), eq(posts.visibility, "public"), cursorCond), limit);
}

/**
 * sinceId の投稿より新しい public の投稿を新しい順に最大 50 件（TIMELINE_SINCE_MAX）返す。
 * sinceId の投稿が現在の世界にないなら空配列を返す
 */
export function getNewerPosts(db: DbOrTx, sinceId: string, worldId?: string): PostWithAuthorRow[] {
  const resolvedWorldId = worldId ?? mustGetCurrentWorld(db).world_id;
  const target = db
    .select({ world_time_sec: posts.world_time_sec, post_id: posts.post_id })
    .from(posts)
    .where(and(eq(posts.post_id, sinceId), eq(posts.world_id, resolvedWorldId)))
    .get();
  if (!target) return [];

  return queryPostsWithAuthors(
    db,
    and(
      eq(posts.world_id, resolvedWorldId),
      eq(posts.visibility, "public"),
      sql`(${posts.world_time_sec}, ${posts.post_id}) > (${target.world_time_sec}, ${target.post_id})`,
    ),
    TIMELINE_SINCE_MAX,
  );
}

/** 投稿 ID ごとの public な返信の数（countReplies） */
export function countReplies(db: DbOrTx, postIds: readonly string[]): Map<string, number> {
  if (postIds.length === 0) return new Map();
  const rows = db
    .select({
      reply_to_post_id: posts.reply_to_post_id,
      n: count(),
    })
    .from(posts)
    .where(and(inArray(posts.reply_to_post_id, [...postIds]), eq(posts.visibility, "public")))
    .groupBy(posts.reply_to_post_id)
    .all();

  const map = new Map<string, number>();
  for (const row of rows) {
    if (row.reply_to_post_id !== null) {
      map.set(row.reply_to_post_id, row.n);
    }
  }
  return map;
}

/** 投稿 ID ごとのいいねの数（countLikes） */
export function countLikes(db: DbOrTx, postIds: readonly string[]): Map<string, number> {
  if (postIds.length === 0) return new Map();
  const rows = db
    .select({
      post_id: likes.post_id,
      n: count(),
    })
    .from(likes)
    .where(inArray(likes.post_id, [...postIds]))
    .groupBy(likes.post_id)
    .all();

  return new Map(rows.map((r) => [r.post_id, r.n]));
}

/** 返信先の投稿 ID から PostRef（postId・handle・displayName）を引く（hidden でも返す。selectReplyTargets） */
export function selectReplyTargets(db: DbOrTx, targetPostIds: readonly string[]): Map<string, PostRef> {
  if (targetPostIds.length === 0) return new Map();
  const rows = db
    .select({
      postId: posts.post_id,
      handle: agents.handle,
      displayName: agents.display_name,
    })
    .from(posts)
    .innerJoin(agents, eq(agents.agent_id, posts.agent_id))
    .where(inArray(posts.post_id, [...targetPostIds]))
    .all();

  return new Map(rows.map((r) => [r.postId, r]));
}

/**
 * 投稿の行に返信数・いいね数・返信先をまとめて付けて PostView[] に変換する（N+1 を避ける）
 */
export function decorateWithCounts(db: DbOrTx, rows: readonly PostWithAuthorRow[]): PostView[] {
  if (rows.length === 0) return [];
  const postIds = rows.map((r) => r.post_id);
  const replyTargetIds = [...new Set(rows.map((r) => r.reply_to_post_id).filter((id): id is string => id !== null))];

  const replyCounts = countReplies(db, postIds);
  const likeCounts = countLikes(db, postIds);
  const replyTargets = selectReplyTargets(db, replyTargetIds);

  return rows.map((row) =>
    toPostView(
      row,
      {
        replyCount: replyCounts.get(row.post_id) ?? 0,
        likeCount: likeCounts.get(row.post_id) ?? 0,
      },
      row.reply_to_post_id ? (replyTargets.get(row.reply_to_post_id) ?? null) : null,
    ),
  );
}

/** limit+1 件で読んだ行から items と nextCursor を組み立てる共通処理 */
export function buildPostCursorPage(
  db: DbOrTx,
  fetchedRows: readonly PostWithAuthorRow[],
  limit: number,
): { items: PostView[]; nextCursor: string | null } {
  const hasMore = fetchedRows.length > limit;
  const pageRows = hasMore ? fetchedRows.slice(0, limit) : fetchedRows;
  const lastRow = pageRows[pageRows.length - 1];
  const nextCursor = hasMore && lastRow ? formatPostCursor(lastRow) : null;
  return {
    items: decorateWithCounts(db, pageRows),
    nextCursor,
  };
}

/** GET /api/timeline：現在の世界の公開中の投稿を新しい順に返す */
export function getTimeline(
  db: DbOrTx,
  clock: Clock,
  params: { cursor?: string | PostCursor; limit: number; since?: string },
): TimelineResponse {
  const world = mustGetCurrentWorld(db);
  const worldSummary = {
    state: world.state as CurrentWorldState,
    worldTimeSec: getWorldTimeSec(world, clock.now()),
  };

  if (params.since !== undefined) {
    const rows = getNewerPosts(db, params.since, world.world_id);
    return {
      world: worldSummary,
      items: decorateWithCounts(db, rows),
      nextCursor: null,
    };
  }

  const parsedCursor = typeof params.cursor === "string" ? parsePostCursor(params.cursor) : params.cursor;
  const fetched = selectTimelinePage(db, world.world_id, parsedCursor, params.limit + 1);
  const page = buildPostCursorPage(db, fetched, params.limit);
  return {
    world: worldSummary,
    ...page,
  };
}
