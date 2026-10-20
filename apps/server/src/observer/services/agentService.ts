// エージェントのプロフィール・過去投稿・フォロー関係（BE 詳細設計 observer 2〜4章 agentService.ts）
import type { AgentPostsResponse, AgentProfileView, FollowType, FollowsResponse } from "@nous/shared";
import { and, count, desc, eq, isNull, sql } from "drizzle-orm";
import { agents, follows, posts } from "../../db/schema";
import type { DbOrTx } from "../../db/tx";
import { AppError } from "../../lib/errors";
import {
  toAgentProfile,
  toFollowItem,
  type AgentRow,
  type AgentSummaryColumns,
  type PostWithAuthorRow,
} from "../mappers";
import {
  buildPostCursorPage,
  mustGetCurrentWorld,
  parsePostCursor,
  queryPostsWithAuthors,
  type PostCursor,
} from "./timelineService";

/** 現在の世界のエージェントを読む（停止中も返す）。いなければ 404 AGENT_NOT_FOUND */
export function selectAgentProfile(db: DbOrTx, worldId: string, agentId: string): AgentRow {
  const row = db
    .select()
    .from(agents)
    .where(and(eq(agents.agent_id, agentId), eq(agents.world_id, worldId)))
    .get();
  if (!row) {
    throw new AppError("AGENT_NOT_FOUND");
  }
  return row;
}

/** 継続中のフォロー中・フォロワーの数を COUNT で取る（countFollows） */
export function countFollows(db: DbOrTx, agentId: string): { followingCount: number; followerCount: number } {
  const followingRow = db
    .select({ n: count() })
    .from(follows)
    .where(and(eq(follows.follower_id, agentId), isNull(follows.ended_world_sec)))
    .get();
  const followerRow = db
    .select({ n: count() })
    .from(follows)
    .where(and(eq(follows.followee_id, agentId), isNull(follows.ended_world_sec)))
    .get();
  return {
    followingCount: followingRow?.n ?? 0,
    followerCount: followerRow?.n ?? 0,
  };
}

/** エージェントの public な投稿の数を COUNT で取る */
export function countAgentPublicPosts(db: DbOrTx, agentId: string): number {
  const row = db
    .select({ n: count() })
    .from(posts)
    .where(and(eq(posts.agent_id, agentId), eq(posts.visibility, "public")))
    .get();
  return row?.n ?? 0;
}

/** GET /api/agents/:agentId：エージェントのプロフィールを返す（activity_level は返さない） */
export function getAgentProfile(db: DbOrTx, agentId: string): AgentProfileView {
  const world = mustGetCurrentWorld(db);
  const agent = selectAgentProfile(db, world.world_id, agentId);
  const { followingCount, followerCount } = countFollows(db, agentId);
  const postCount = countAgentPublicPosts(db, agentId);
  return toAgentProfile(agent, { followingCount, followerCount, postCount });
}

/** エージェントの public の投稿を (world_time_sec, post_id) 降順で limit 件読む（selectAgentPostsPage） */
export function selectAgentPostsPage(
  db: DbOrTx,
  agentId: string,
  cursor: PostCursor | undefined,
  limit: number,
): PostWithAuthorRow[] {
  const cursorCond = cursor
    ? sql`(${posts.world_time_sec}, ${posts.post_id}) < (${cursor.worldTimeSec}, ${cursor.postId})`
    : undefined;
  return queryPostsWithAuthors(db, and(eq(posts.agent_id, agentId), eq(posts.visibility, "public"), cursorCond), limit);
}

/** GET /api/agents/:agentId/posts：エージェントの過去投稿（返信を含む、public のみ）を返す */
export function getAgentPosts(
  db: DbOrTx,
  params: { agentId: string; cursor?: string | PostCursor; limit: number },
): AgentPostsResponse {
  const world = mustGetCurrentWorld(db);
  selectAgentProfile(db, world.world_id, params.agentId);
  const parsedCursor = typeof params.cursor === "string" ? parsePostCursor(params.cursor) : params.cursor;
  const fetched = selectAgentPostsPage(db, params.agentId, parsedCursor, params.limit + 1);
  return buildPostCursorPage(db, fetched, params.limit);
}

/** 継続中のフォロー中またはフォロワーを started_world_sec の降順で読む（selectFollows） */
export function selectFollows(
  db: DbOrTx,
  agentId: string,
  type: FollowType,
): Array<AgentSummaryColumns & { started_world_sec: number }> {
  const joinCond =
    type === "following" ? eq(agents.agent_id, follows.followee_id) : eq(agents.agent_id, follows.follower_id);
  const selfCond = type === "following" ? eq(follows.follower_id, agentId) : eq(follows.followee_id, agentId);

  return db
    .select({
      agent_id: agents.agent_id,
      handle: agents.handle,
      display_name: agents.display_name,
      state: agents.state,
      started_world_sec: follows.started_world_sec,
    })
    .from(follows)
    .innerJoin(agents, joinCond)
    .where(and(selfCond, isNull(follows.ended_world_sec)))
    .orderBy(desc(follows.started_world_sec), desc(follows.follow_id))
    .all();
}

/** GET /api/agents/:agentId/follows：継続中のフォロー中またはフォロワーを返す */
export function getFollows(db: DbOrTx, params: { agentId: string; type: FollowType }): FollowsResponse {
  const world = mustGetCurrentWorld(db);
  selectAgentProfile(db, world.world_id, params.agentId);
  const rows = selectFollows(db, params.agentId, params.type);
  return {
    items: rows.map((row) => toFollowItem(row)),
  };
}
