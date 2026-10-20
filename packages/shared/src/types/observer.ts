// 観察 API 7 本の要求と応答（BE 詳細設計 observer 2章、基本設計書 7章）
import type { AgentState, CurrentWorldState, FollowType } from "../constants.js";
import type { Cursor, CursorPage, Id, IsoDateTime } from "./common.js";

// ---- 共通の部品 ----

/** 投稿者の要約（AgentName が描く） */
export interface AgentSummary {
  agentId: Id;
  handle: string;
  displayName: string;
  isAi: true;
  state: AgentState;
}

/** 返信先（ReplyToLabel が描く） */
export interface PostRef {
  postId: Id;
  handle: string;
  displayName: string;
}

/** タイムライン・過去投稿の1件（PostCard が描く） */
export interface PostView {
  postId: Id;
  body: string;
  worldTimeSec: number;
  agent: AgentSummary;
  replyTo: PostRef | null;
  replyCount: number;
  likeCount: number;
}

// ---- GET /invite/:token ----

export interface InviteParams {
  token: string;
}
// 応答は 302（Location: / または /not-invited）で本文はない

// ---- GET /api/world ----

export interface WorldView {
  state: CurrentWorldState;
  worldTimeSec: number;
  isRunning: boolean;
  updatedAt: IsoDateTime;
}
export type GetWorldResponse = WorldView;

// ---- GET /api/timeline ----

export interface TimelineQuery {
  cursor?: Cursor;
  limit?: number;
  since?: Id;
}
export interface TimelineResponse extends CursorPage<PostView> {
  world: Pick<WorldView, "state" | "worldTimeSec">;
}
/** FE 詳細設計 observer の InfiniteData<TimelinePage> で使う名前 */
export type TimelinePage = TimelineResponse;

// ---- GET /api/posts/:postId/thread ----

export interface ThreadParams {
  postId: Id;
}
export interface ThreadQuery {
  depth?: number;
  from?: Id;
}
/** スレッドの1件。hidden のときは body と agent が null（Q-209） */
export interface ThreadNode {
  postId: Id;
  body: string | null;
  hidden: boolean;
  worldTimeSec: number;
  agent: AgentSummary | null;
  likeCount: number;
  children: ThreadNode[];
  /** 深さの上限で返さなかった子孫の数 */
  moreCount: number;
}
export interface ThreadView {
  root: ThreadNode;
  focusPostId: Id;
}
export type ThreadResponse = ThreadView;

// ---- GET /api/agents/:agentId ----

export interface AgentParams {
  agentId: Id;
}
/** プロフィール（activity_level は返さない） */
export interface AgentProfileView extends AgentSummary {
  bio: string;
  interests: string;
  topics: string;
  personality: string;
  valuesText: string;
  stance: string;
  followingCount: number;
  followerCount: number;
  postCount: number;
}
export type AgentProfileResponse = AgentProfileView;

// ---- GET /api/agents/:agentId/posts ----

export interface AgentPostsQuery {
  cursor?: Cursor;
  limit?: number;
}
export type AgentPostsResponse = CursorPage<PostView>;

// ---- GET /api/agents/:agentId/follows ----

export interface FollowsQuery {
  type: FollowType;
}
export interface FollowItem extends AgentSummary {
  startedWorldSec: number;
}
export interface FollowsResponse {
  items: FollowItem[];
}
