// 管理 API：データ操作の 16 本（BE 詳細設計 admin_data 2章）
import type {
  Action,
  AgentState,
  AttemptResult,
  ConsistencyCode,
  DecidedBy,
  FailureKind,
  GenerationStatus,
  HideOperation,
  LlmMode,
  Visibility,
  WorldState,
} from "../constants.js";
import type { Cursor, CursorPage, Id, IsoDateTime, JsonValue, NoContent, UsageDate } from "./common.js";

/** 管理の一覧で使うエージェントの要約 */
export interface AdminAgentRef {
  agentId: Id;
  displayName: string;
}

// ---- GET /admin/api/agents ----

export interface AgentListQuery {
  state?: AgentState;
}
export interface AdminAgentItem {
  agentId: Id;
  handle: string;
  displayName: string;
  state: AgentState;
  activityLevel: number;
  postCount: number;
  lastActionAt: IsoDateTime | null;
  lastAction: Action | null;
}
export interface AgentListResponse {
  items: AdminAgentItem[];
  worldState: WorldState;
}

// ---- POST /admin/api/agents・PUT /admin/api/agents/:agentId ----
// 要求の型 AgentInput は schemas/agent.ts（AgentInputSchema）から導く

export interface AgentIdParams {
  agentId: Id;
}
export interface AgentSaveResponse {
  agentId: Id;
}
export type AgentCreateResponse = AgentSaveResponse;
export type AgentUpdateResponse = AgentSaveResponse;

// ---- DELETE /admin/api/agents/:agentId ----

export type AgentDeleteResponse = NoContent;

// ---- POST /admin/api/agents/:agentId/stop・resume ----

export interface AgentStopResponse {
  agentId: Id;
  state: "stopped";
}
export interface AgentResumeResponse {
  agentId: Id;
  state: "active";
}

// ---- GET /admin/api/generations ----

export interface GenerationListQuery {
  agentId?: Id;
  action?: Action;
  status?: GenerationStatus;
  from?: IsoDateTime;
  to?: IsoDateTime;
  cursor?: Cursor;
  limit?: number;
}
export interface GenerationItem {
  eventId: Id;
  startedAt: IsoDateTime;
  worldTimeSec: number;
  agent: AdminAgentRef;
  action: Action | null;
  decidedBy: DecidedBy;
  status: GenerationStatus;
  failureKind: FailureKind | null;
  neurons: number;
  attemptCount: number;
  hasConsistencyFlags: boolean;
}
export type GenerationPage = CursorPage<GenerationItem>;
export type GenerationListResponse = GenerationPage;

// ---- GET /admin/api/generations/:eventId ----

export interface GenerationParams {
  eventId: Id;
}
/** 記憶との矛盾の候補（generation_events.consistency_flags の1件） */
export interface ConsistencyFlag {
  code: ConsistencyCode;
  detail: string;
}
/** 生成イベントの全項目 */
export interface GenerationEventDetail {
  eventId: Id;
  worldId: Id;
  agent: AdminAgentRef & { handle: string };
  cycleNo: number;
  cycleSeed: number;
  status: GenerationStatus;
  decidedBy: DecidedBy;
  action: Action | null;
  failureKind: FailureKind | null;
  /** gate で決まったときは null */
  actionCandidates: Action[] | null;
  inputAttributes: { [key: string]: JsonValue };
  inputMemories: JsonValue[];
  inputPostIds: Id[];
  promptText: string | null;
  outputText: string | null;
  modelId: string | null;
  promptVersion: string | null;
  llmMode: LlmMode;
  promptTokens: number;
  completionTokens: number;
  neurons: number;
  costJpy: 0;
  consistencyFlags: ConsistencyFlag[] | null;
  worldTimeSec: number;
  startedAt: IsoDateTime;
  finishedAt: IsoDateTime | null;
}
export interface GenerationAttempt {
  attemptNo: number;
  result: AttemptResult;
  httpStatus: number | null;
  errorDetail: string | null;
  promptTokens: number;
  completionTokens: number;
  neurons: number;
  durationMs: number;
}
export interface RefPost {
  /** 入力での番号（P1 など） */
  label: string;
  postId: Id;
  /** 本文の先頭 40 字 */
  excerpt: string;
}
export interface ResultPost {
  postId: Id;
  body: string;
  visibility: Visibility;
}
export interface GenerationDetail {
  event: GenerationEventDetail;
  attempts: GenerationAttempt[];
  refPosts: RefPost[];
  resultPost: ResultPost | null;
}
export type GenerationDetailResponse = GenerationDetail;

// ---- GET /admin/api/posts ----

export interface PostSearchQuery {
  q?: string;
  visibility?: Visibility;
  agentId?: Id;
  postId?: Id;
  cursor?: Cursor;
  limit?: number;
}
export interface AdminPostItem {
  postId: Id;
  body: string;
  visibility: Visibility;
  worldTimeSec: number;
  createdAt: IsoDateTime;
  agent: AdminAgentRef;
  replyToPostId: Id | null;
  generationEventId: Id | null;
}
export type PostPage = CursorPage<AdminPostItem>;
export type PostSearchResponse = PostPage;

// ---- POST /admin/api/posts/:postId/hide・unhide ----

export interface PostIdParams {
  postId: Id;
}
// 要求の型 HideRequest は schemas/moderation.ts（HideRequestSchema）から導く
export interface PostHideResponse {
  postId: Id;
  visibility: "hidden";
}
export interface PostUnhideResponse {
  postId: Id;
  visibility: "public";
}

// ---- GET /admin/api/hide-records ----

export interface HideRecordQuery {
  cursor?: Cursor;
  limit?: number;
}
export interface HideRecordItem {
  hideId: Id;
  postId: Id;
  operation: HideOperation;
  reason: string | null;
  operatedAt: IsoDateTime;
  /** 本文の先頭 40 字 */
  postBodyExcerpt: string;
}
export type HideRecordPage = CursorPage<HideRecordItem>;
export type HideRecordListResponse = HideRecordPage;

// ---- GET /admin/api/metrics/daily ----

export interface MetricsQuery {
  from?: UsageDate;
  to?: UsageDate;
}
export interface DailyMetricsItem {
  usageDate: UsageDate;
  calls: number;
  runs: number;
  promptTokens: number;
  completionTokens: number;
  neurons: number;
  costJpy: 0;
  posts: number;
  replies: number;
  /** posts が 0 なら null */
  replyRate: number | null;
  likes: number;
  follows: number;
  nones: number;
  actions: number;
  failures: number;
  /** runs が 0 なら null */
  errorRate: number | null;
}
export interface MetricsView {
  freeTierNeurons: number;
  neuronsLimit: number;
  items: DailyMetricsItem[];
}
export type MetricsResponse = MetricsView;

// ---- GET /admin/api/worlds ----

export interface WorldItem {
  worldId: Id;
  name: string;
  state: WorldState;
  createdAt: IsoDateTime;
  startedAt: IsoDateTime | null;
  archivedAt: IsoDateTime | null;
  worldTimeSec: number;
  agentCount: number;
  postCount: number;
}
export interface WorldListResponse {
  items: WorldItem[];
}

// ---- GET /admin/api/worlds/:worldId/posts・generations ----

export interface WorldIdParams {
  worldId: Id;
}
export interface WorldPageQuery {
  cursor?: Cursor;
  limit?: number;
}
export type WorldPostsResponse = PostPage;
export type WorldGenerationsResponse = GenerationPage;
