// 行から観察 API の応答への変換（BE 詳細設計 observer 1章・4章 mappers.ts、FR-105）
import type {
  AgentProfileView,
  AgentState,
  AgentSummary,
  FollowItem,
  PostRef,
  PostView,
  ThreadNode,
  Visibility,
} from "@nous/shared";
import type { agents, posts } from "../db/schema";

export type AgentRow = typeof agents.$inferSelect;
export type PostRow = typeof posts.$inferSelect;

/** toAgentSummary が必要とするエージェントの最小列 */
export interface AgentSummaryColumns {
  agent_id: string;
  handle: string;
  display_name: string;
  state: AgentState;
}

/** 投稿と投稿者（JOIN の結果） */
export interface PostWithAuthorRow {
  post_id: string;
  body: string;
  world_time_sec: number;
  reply_to_post_id: string | null;
  agent: AgentSummaryColumns;
}

/** スレッドの投稿（hidden の可能性があり、agents は LEFT JOIN） */
export interface ThreadPostRow {
  post_id: string;
  body: string;
  visibility: Visibility;
  world_time_sec: number;
  reply_to_post_id: string | null;
  agent: AgentSummaryColumns | null;
}

/** agentId・handle・displayName・state を写し、isAi: true を必ず付ける（FR-105） */
export function toAgentSummary(row: AgentSummaryColumns): AgentSummary {
  return {
    agentId: row.agent_id,
    handle: row.handle,
    displayName: row.display_name,
    isAi: true,
    state: row.state,
  };
}

/** postId・body・worldTimeSec・agent・replyTo・replyCount・likeCount を組み立てる */
export function toPostView(
  row: PostWithAuthorRow,
  counts: { replyCount: number; likeCount: number },
  replyTarget: PostRef | null,
): PostView {
  return {
    postId: row.post_id,
    body: row.body,
    worldTimeSec: row.world_time_sec,
    agent: toAgentSummary(row.agent),
    replyTo: replyTarget,
    replyCount: counts.replyCount,
    likeCount: counts.likeCount,
  };
}

/**
 * スレッドの節を作る。hidden なら body と agent を null にし、hidden: true とする（Q-209）。
 * それ以外は toAgentSummary を付ける
 */
export function toThreadNode(
  row: ThreadPostRow,
  children: ThreadNode[],
  options: { likeCount?: number; moreCount?: number } = {},
): ThreadNode {
  const hidden = row.visibility === "hidden";
  return {
    postId: row.post_id,
    body: hidden ? null : row.body,
    hidden,
    worldTimeSec: row.world_time_sec,
    agent: hidden || !row.agent ? null : toAgentSummary(row.agent),
    likeCount: options.likeCount ?? 0,
    children,
    moreCount: options.moreCount ?? 0,
  };
}

/** エージェントのプロフィール（activity_level は返さない。P103 の業務ルール） */
export function toAgentProfile(
  row: AgentRow,
  counts: { followingCount: number; followerCount: number; postCount: number },
): AgentProfileView {
  return {
    ...toAgentSummary(row),
    bio: row.bio,
    interests: row.interests,
    topics: row.topics,
    personality: row.personality,
    valuesText: row.values_text,
    stance: row.stance,
    followingCount: counts.followingCount,
    followerCount: counts.followerCount,
    postCount: counts.postCount,
  };
}

/** フォロー中・フォロワーの1件（AgentSummary ＋ startedWorldSec） */
export function toFollowItem(row: AgentSummaryColumns & { started_world_sec: number }): FollowItem {
  return {
    ...toAgentSummary(row),
    startedWorldSec: row.started_world_sec,
  };
}
