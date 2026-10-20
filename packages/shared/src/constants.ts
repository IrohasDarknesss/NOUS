// 画面とサーバーで共用する定数。値は DB 物理設計書（schema.sql の CHECK）と基本設計書 7章に合わせる。

/** 観察サーバーと管理サーバーの既定のポート（基本設計書 7章 内部API一覧） */
export const OBSERVER_PORT = 8080;
export const ADMIN_PORT = 8081;

/** ULID の長さ（world_id・agent_id・post_id など全ての ID） */
export const ID_LENGTH = 26;
/** 招待トークン・セッション ID・CSRF トークンの長さ（32 バイトの Base64URL） */
export const TOKEN_LENGTH = 43;

/** 閲覧の Cookie（招待トークン）。有効 180 日 */
export const VIEW_COOKIE_NAME = "aisns_view";
export const VIEW_COOKIE_MAX_AGE_SEC = 15_552_000;
/** 管理セッションの Cookie */
export const ADMIN_COOKIE_NAME = "aisns_admin";
/** 変更の要求に付ける CSRF トークンのヘッダー */
export const CSRF_HEADER_NAME = "X-CSRF-Token";

/** Cloudflare Workers AI の無料枠（1日の Neurons） */
export const FREE_TIER_NEURONS = 10_000;

/** 投稿の本文の上限（posts.body） */
export const POST_BODY_MAX = 140;
/** 抜粋（refPosts.excerpt・postBodyExcerpt）の字数 */
export const EXCERPT_LENGTH = 40;

// ---- 列挙値（schema.sql の CHECK） ----

/** worlds.state */
export const WORLD_STATES = [
  "preparing",
  "running",
  "paused",
  "limit_stopped",
  "emergency_stopped",
  "archived",
] as const;
export type WorldState = (typeof WORLD_STATES)[number];
/** 現在の世界がとりうる状態（archived 以外。GET /api/world の state） */
export type CurrentWorldState = Exclude<WorldState, "archived">;

/** worlds.stop_reason */
export const STOP_REASONS = ["neurons_limit", "runs_limit", "free_tier_error", "manual_pause", "emergency"] as const;
export type StopReason = (typeof STOP_REASONS)[number];

/** agents.state */
export const AGENT_STATES = ["active", "stopped"] as const;
export type AgentState = (typeof AGENT_STATES)[number];

/** generation_events.action */
export const ACTIONS = ["post", "reply", "like", "follow", "unfollow", "none"] as const;
export type Action = (typeof ACTIONS)[number];

/** generation_events.status */
export const GENERATION_STATUSES = ["running", "succeeded", "failed", "cancelled", "interrupted"] as const;
export type GenerationStatus = (typeof GENERATION_STATUSES)[number];

/** generation_events.decided_by */
export const DECIDED_BY = ["gate", "llm"] as const;
export type DecidedBy = (typeof DECIDED_BY)[number];

/** generation_events.failure_kind */
export const FAILURE_KINDS = [
  "timeout",
  "rate_limited",
  "server_error",
  "invalid_format",
  "free_tier",
  "cancelled",
  "stopped",
  "interrupted",
] as const;
export type FailureKind = (typeof FAILURE_KINDS)[number];

/** generation_events.llm_mode */
export const LLM_MODES = ["cloudflare", "fixed"] as const;
export type LlmMode = (typeof LLM_MODES)[number];

/** generation_attempts.result */
export const ATTEMPT_RESULTS = [
  "ok",
  "timeout",
  "rate_limited",
  "server_error",
  "invalid_format",
  "free_tier",
  "cancelled",
] as const;
export type AttemptResult = (typeof ATTEMPT_RESULTS)[number];

/** posts.visibility */
export const VISIBILITIES = ["public", "hidden"] as const;
export type Visibility = (typeof VISIBILITIES)[number];

/** hide_records.operation */
export const HIDE_OPERATIONS = ["hide", "unhide"] as const;
export type HideOperation = (typeof HIDE_OPERATIONS)[number];

/** memories.kind */
export const MEMORY_KINDS = [
  "interest_profile",
  "recent_posts",
  "relationship_summary",
  "conversation_summary",
] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];

/** 記憶との矛盾の候補のコード（行動生成とプロンプトの設計 C01〜C04） */
export const CONSISTENCY_CODES = ["C01", "C02", "C03", "C04"] as const;
export type ConsistencyCode = (typeof CONSISTENCY_CODES)[number];

/** admin_audit_logs.operation（18 種） */
export const AUDIT_OPERATIONS = [
  "world.start",
  "world.pause",
  "world.resume",
  "world.emergency_stop",
  "world.reset",
  "settings.update",
  "agent.create",
  "agent.update",
  "agent.delete",
  "agent.stop",
  "agent.resume",
  "post.hide",
  "post.unhide",
  "invitation.issue",
  "invitation.revoke",
  "admin.login",
  "admin.logout",
  "admin.login_failed",
] as const;
export type AuditOperation = (typeof AUDIT_OPERATIONS)[number];

/** admin_audit_logs.target_type */
export const AUDIT_TARGET_TYPES = ["world", "agent", "post", "invitation", "settings", "admin"] as const;
export type AuditTargetType = (typeof AUDIT_TARGET_TYPES)[number];

/** GET /api/agents/:agentId/follows の type */
export const FOLLOW_TYPES = ["following", "followers"] as const;
export type FollowType = (typeof FOLLOW_TYPES)[number];

/** world_settings.model_id の候補（GET /admin/api/settings の modelOptions） */
export const MODEL_OPTIONS = ["@cf/google/gemma-4-26b-a4b-it", "@cf/qwen/qwen3-30b-a3b-fp8"] as const;
export type ModelId = (typeof MODEL_OPTIONS)[number];

// ---- 実行設定（world_settings。PUT /admin/api/settings の範囲と既定値） ----

export const SETTINGS_RANGES = {
  cycleMinutes: { min: 15, max: 120 },
  activityPercent: { min: 10, max: 100 },
  maxRefPosts: { min: 1, max: 30 },
  maxMemoryChars: { min: 200, max: 3000 },
  maxInputTokens: { min: 500, max: 2000 },
  maxOutputTokens: { min: 100, max: 400 },
  dailyNeuronsLimit: { min: 1, max: 10_000 },
  dailyRunsLimit: { min: 1, max: 2000 },
  maxConcurrency: { min: 1, max: 3 },
} as const;
export type NumericSettingKey = keyof typeof SETTINGS_RANGES;

export const PROMPT_VERSION_MAX = 20;

export const DEFAULT_SETTINGS = {
  cycleMinutes: 20,
  activityPercent: 100,
  maxRefPosts: 12,
  maxMemoryChars: 1200,
  maxInputTokens: 1500,
  maxOutputTokens: 300,
  dailyNeuronsLimit: 9500,
  dailyRunsLimit: 480,
  maxConcurrency: 1,
  modelId: "@cf/google/gemma-4-26b-a4b-it",
  promptVersion: "v1",
} as const;

// ---- エージェントの入力（POST・PUT /admin/api/agents） ----

export const AGENT_LIMITS = {
  handle: { min: 3, max: 20 },
  displayName: { min: 1, max: 30 },
  bio: { max: 200 },
  /** interests・topics・personality・valuesText・stance */
  attribute: { min: 1, max: 100 },
  activityLevel: { min: 1, max: 5 },
} as const;
export const HANDLE_PATTERN = /^[A-Za-z0-9_]+$/;
export const DEFAULT_ACTIVITY_LEVEL = 3;

// ---- そのほかの入力の上限 ----

export const ADMIN_PASSWORD_LENGTH = { min: 12, max: 128 } as const;
export const INVITATION_LABEL_MAX = 30;
export const HIDE_REASON_MAX = 200;
export const POST_SEARCH_QUERY_MAX = 50;
export const WORLD_NAME_MAX = 50;

// ---- ページ送り ----

/** 観察 API（timeline・agents/:agentId/posts）の limit */
export const OBSERVER_PAGE_LIMIT = { min: 1, max: 50, default: 30 } as const;
/** timeline の since で返す最大件数 */
export const TIMELINE_SINCE_MAX = 50;
/** 管理 API の一覧の limit */
export const ADMIN_PAGE_LIMIT = { min: 1, max: 100, default: 50 } as const;
/** スレッドの depth */
export const THREAD_DEPTH = { min: 1, max: 10, default: 5 } as const;
/** 日別の指標の期間（既定は直近 14 日、最大 90 日） */
export const METRICS_DEFAULT_DAYS = 14;
export const METRICS_MAX_DAYS = 90;

// ---- エラーコード（エラーの本文 error.code） ----

export const ERROR_CODES = [
  "VALIDATION_ERROR",
  "INTERNAL_ERROR",
  // 観察
  "FORBIDDEN_NETWORK",
  "WRITE_NOT_ALLOWED",
  "VIEW_NOT_INVITED",
  "POST_NOT_FOUND",
  "AGENT_NOT_FOUND",
  // 管理・認証
  "ADMIN_UNAUTHORIZED",
  "CSRF_INVALID",
  "LOGIN_FAILED",
  "LOGIN_LOCKED",
  "ADMIN_NOT_SET",
  // 管理・世界
  "STATE_CONFLICT",
  "NO_AGENTS",
  "CONFIRM_MISMATCH",
  "GENERATION_RUNNING",
  // 管理・データ
  "HANDLE_TAKEN",
  "ALREADY_STOPPED",
  "ALREADY_ACTIVE",
  "EVENT_NOT_FOUND",
  "ALREADY_HIDDEN",
  "NOT_HIDDEN",
  "WORLD_NOT_FOUND",
  // 管理・招待
  "INVITATION_NOT_FOUND",
  "ALREADY_REVOKED",
  "LAN_ADDRESS_NOT_FOUND",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];
