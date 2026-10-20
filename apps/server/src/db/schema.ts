// NOUS の DB スキーマ（DB 物理設計書 3・4章、docs/design/detailed/schema.sql）。
// テーブル名・カラム名は物理名のまま（camelCase への変換は API の層で行う）。
// STRICT と CHECK の正は migrations/0000_init.sql。ここの check() は drizzle-kit のスナップショットに残すための写し。
import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/** CHECK 制約。名前は <テーブル>_<カラム>_check とし、式は schema.sql と同じ文字列にする */
const ck = (table: string, column: string, expr: string) => check(`${table}_${column}_check`, sql.raw(expr));

/** ISO 8601 の UTC（24 字）の必須カラム */
const isoNN = (table: string, column: string) => ck(table, column, `length(${column}) = 24`);
/** ISO 8601 の UTC（24 字）の任意カラム */
const isoNull = (table: string, column: string) => ck(table, column, `(${column} IS NULL OR length(${column}) = 24)`);

// ---- 区分値（DB 物理設計書 5章） ----
export const WORLD_STATES = [
  "preparing",
  "running",
  "paused",
  "limit_stopped",
  "emergency_stopped",
  "archived",
] as const;
export const STOP_REASONS = ["neurons_limit", "runs_limit", "free_tier_error", "manual_pause", "emergency"] as const;
export const MODEL_IDS = ["@cf/google/gemma-4-26b-a4b-it", "@cf/qwen/qwen3-30b-a3b-fp8"] as const;
export const AGENT_STATES = ["active", "stopped"] as const;
export const POST_VISIBILITIES = ["public", "hidden"] as const;
export const MEMORY_KINDS = [
  "interest_profile",
  "recent_posts",
  "relationship_summary",
  "conversation_summary",
] as const;
export const GENERATION_STATUSES = ["running", "succeeded", "failed", "cancelled", "interrupted"] as const;
export const DECIDED_BY = ["gate", "llm"] as const;
export const ACTIONS = ["post", "reply", "like", "follow", "unfollow", "none"] as const;
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
export const LLM_MODES = ["cloudflare", "fixed"] as const;
export const ATTEMPT_RESULTS = [
  "ok",
  "timeout",
  "rate_limited",
  "server_error",
  "invalid_format",
  "free_tier",
  "cancelled",
] as const;
export const HIDE_OPERATIONS = ["hide", "unhide"] as const;
export const VIEW_RESULTS = ["allowed", "denied"] as const;
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
export const AUDIT_TARGET_TYPES = ["world", "agent", "post", "invitation", "settings", "admin"] as const;

/** 区分値の配列から CHECK の IN 句を作る（'a', 'b' の形） */
const inList = (values: readonly string[]) => values.map((v) => `'${v}'`).join(", ");

// ---- 1. worlds ----
export const worlds = sqliteTable(
  "worlds",
  {
    world_id: text("world_id").primaryKey(),
    name: text("name").notNull(),
    state: text("state", { enum: WORLD_STATES }).notNull().default("preparing"),
    stop_reason: text("stop_reason", { enum: STOP_REASONS }),
    world_elapsed_sec: integer("world_elapsed_sec").notNull().default(0),
    running_since: text("running_since"),
    heartbeat_at: text("heartbeat_at"),
    cycle_no: integer("cycle_no").notNull().default(0),
    next_cycle_at: text("next_cycle_at"),
    created_at: text("created_at").notNull(),
    started_at: text("started_at"),
    archived_at: text("archived_at"),
  },
  () => ({
    c1: ck("worlds", "world_id", "length(world_id) = 26"),
    c2: ck("worlds", "name", "length(name) BETWEEN 1 AND 50"),
    c3: ck("worlds", "state", `state IN (${inList(WORLD_STATES)})`),
    c4: ck("worlds", "stop_reason", `stop_reason IS NULL OR stop_reason IN (${inList(STOP_REASONS)})`),
    c5: ck("worlds", "world_elapsed_sec", "world_elapsed_sec >= 0"),
    c6: ck(
      "worlds",
      "running_since",
      "(running_since IS NULL OR length(running_since) = 24) AND ((state = 'running') = (running_since IS NOT NULL))",
    ),
    c7: isoNull("worlds", "heartbeat_at"),
    c8: ck("worlds", "cycle_no", "cycle_no >= 0"),
    c9: isoNull("worlds", "next_cycle_at"),
    c10: isoNN("worlds", "created_at"),
    c11: isoNull("worlds", "started_at"),
    c12: ck(
      "worlds",
      "archived_at",
      "(archived_at IS NULL OR length(archived_at) = 24) AND ((state = 'archived') = (archived_at IS NOT NULL))",
    ),
    ux_worlds_current: uniqueIndex("ux_worlds_current")
      .on(sql`(1)`)
      .where(sql`state <> 'archived'`),
  }),
);

// ---- 2. world_settings ----
export const world_settings = sqliteTable(
  "world_settings",
  {
    world_id: text("world_id")
      .primaryKey()
      .references(() => worlds.world_id),
    cycle_minutes: integer("cycle_minutes").notNull().default(20),
    activity_percent: integer("activity_percent").notNull().default(100),
    max_ref_posts: integer("max_ref_posts").notNull().default(12),
    max_memory_chars: integer("max_memory_chars").notNull().default(1200),
    max_input_tokens: integer("max_input_tokens").notNull().default(1500),
    max_output_tokens: integer("max_output_tokens").notNull().default(300),
    daily_neurons_limit: integer("daily_neurons_limit").notNull().default(9500),
    daily_runs_limit: integer("daily_runs_limit").notNull().default(480),
    max_concurrency: integer("max_concurrency").notNull().default(1),
    model_id: text("model_id", { enum: MODEL_IDS }).notNull().default("@cf/google/gemma-4-26b-a4b-it"),
    prompt_version: text("prompt_version").notNull().default("v1"),
    updated_at: text("updated_at").notNull(),
  },
  () => ({
    c1: ck("world_settings", "cycle_minutes", "cycle_minutes BETWEEN 15 AND 120"),
    c2: ck("world_settings", "activity_percent", "activity_percent BETWEEN 10 AND 100"),
    c3: ck("world_settings", "max_ref_posts", "max_ref_posts BETWEEN 1 AND 30"),
    c4: ck("world_settings", "max_memory_chars", "max_memory_chars BETWEEN 200 AND 3000"),
    c5: ck("world_settings", "max_input_tokens", "max_input_tokens BETWEEN 500 AND 2000"),
    c6: ck("world_settings", "max_output_tokens", "max_output_tokens BETWEEN 100 AND 400"),
    c7: ck("world_settings", "daily_neurons_limit", "daily_neurons_limit BETWEEN 1 AND 10000"),
    c8: ck("world_settings", "daily_runs_limit", "daily_runs_limit BETWEEN 1 AND 2000"),
    c9: ck("world_settings", "max_concurrency", "max_concurrency BETWEEN 1 AND 3"),
    c10: ck("world_settings", "model_id", `model_id IN (${inList(MODEL_IDS)})`),
    c11: ck("world_settings", "prompt_version", "length(prompt_version) BETWEEN 1 AND 20"),
    c12: isoNN("world_settings", "updated_at"),
  }),
);

// ---- 3. agents ----
export const agents = sqliteTable(
  "agents",
  {
    agent_id: text("agent_id").primaryKey(),
    world_id: text("world_id")
      .notNull()
      .references(() => worlds.world_id),
    handle: text("handle").notNull(),
    display_name: text("display_name").notNull(),
    bio: text("bio").notNull().default(""),
    interests: text("interests").notNull(),
    topics: text("topics").notNull(),
    personality: text("personality").notNull(),
    values_text: text("values_text").notNull(),
    stance: text("stance").notNull(),
    activity_level: integer("activity_level").notNull().default(3),
    state: text("state", { enum: AGENT_STATES }).notNull().default("active"),
    created_at: text("created_at").notNull(),
    updated_at: text("updated_at").notNull(),
  },
  (t) => ({
    c1: ck("agents", "agent_id", "length(agent_id) = 26"),
    c2: ck("agents", "handle", "length(handle) BETWEEN 3 AND 20 AND handle NOT GLOB '*[^A-Za-z0-9_]*'"),
    c3: ck("agents", "display_name", "length(display_name) BETWEEN 1 AND 30"),
    c4: ck("agents", "bio", "length(bio) <= 200"),
    c5: ck("agents", "interests", "length(interests) BETWEEN 1 AND 100"),
    c6: ck("agents", "topics", "length(topics) BETWEEN 1 AND 100"),
    c7: ck("agents", "personality", "length(personality) BETWEEN 1 AND 100"),
    c8: ck("agents", "values_text", "length(values_text) BETWEEN 1 AND 100"),
    c9: ck("agents", "stance", "length(stance) BETWEEN 1 AND 100"),
    c10: ck("agents", "activity_level", "activity_level BETWEEN 1 AND 5"),
    c11: ck("agents", "state", `state IN (${inList(AGENT_STATES)})`),
    c12: isoNN("agents", "created_at"),
    c13: isoNN("agents", "updated_at"),
    ux_agents_world_handle: uniqueIndex("ux_agents_world_handle").on(t.world_id, t.handle),
    idx_agents_world_state: index("idx_agents_world_state").on(t.world_id, t.state),
  }),
);

// ---- 8. generation_events（posts・likes・follows が参照するので先に定義する） ----
export const generation_events = sqliteTable(
  "generation_events",
  {
    event_id: text("event_id").primaryKey(),
    world_id: text("world_id")
      .notNull()
      .references(() => worlds.world_id),
    agent_id: text("agent_id")
      .notNull()
      .references(() => agents.agent_id),
    cycle_no: integer("cycle_no").notNull(),
    cycle_seed: integer("cycle_seed").notNull(),
    status: text("status", { enum: GENERATION_STATUSES }).notNull().default("running"),
    decided_by: text("decided_by", { enum: DECIDED_BY }).notNull(),
    action: text("action", { enum: ACTIONS }),
    failure_kind: text("failure_kind", { enum: FAILURE_KINDS }),
    action_candidates: text("action_candidates"),
    input_attributes: text("input_attributes").notNull().default("{}"),
    input_memories: text("input_memories").notNull().default("[]"),
    input_post_ids: text("input_post_ids").notNull().default("[]"),
    prompt_text: text("prompt_text"),
    output_text: text("output_text"),
    model_id: text("model_id").notNull(),
    prompt_version: text("prompt_version").notNull(),
    llm_mode: text("llm_mode", { enum: LLM_MODES }).notNull(),
    prompt_tokens: integer("prompt_tokens").notNull().default(0),
    completion_tokens: integer("completion_tokens").notNull().default(0),
    neurons: real("neurons").notNull().default(0),
    cost_jpy: integer("cost_jpy").notNull().default(0),
    consistency_flags: text("consistency_flags"),
    world_time_sec: integer("world_time_sec").notNull(),
    started_at: text("started_at").notNull(),
    finished_at: text("finished_at"),
    usage_date: text("usage_date").notNull(),
  },
  (t) => ({
    c1: ck("generation_events", "event_id", "length(event_id) = 26"),
    c2: ck("generation_events", "cycle_no", "cycle_no >= 1"),
    c3: ck("generation_events", "status", `status IN (${inList(GENERATION_STATUSES)})`),
    c4: ck("generation_events", "decided_by", `decided_by IN (${inList(DECIDED_BY)})`),
    c5: ck("generation_events", "action", `action IS NULL OR action IN (${inList(ACTIONS)})`),
    c6: ck("generation_events", "failure_kind", `failure_kind IS NULL OR failure_kind IN (${inList(FAILURE_KINDS)})`),
    c7: ck("generation_events", "action_candidates", "action_candidates IS NULL OR json_valid(action_candidates)"),
    c8: ck("generation_events", "input_attributes", "json_valid(input_attributes)"),
    c9: ck("generation_events", "input_memories", "json_valid(input_memories)"),
    c10: ck("generation_events", "input_post_ids", "json_valid(input_post_ids)"),
    c11: ck("generation_events", "llm_mode", `llm_mode IN (${inList(LLM_MODES)})`),
    c12: ck("generation_events", "prompt_tokens", "prompt_tokens >= 0"),
    c13: ck("generation_events", "completion_tokens", "completion_tokens >= 0"),
    c14: ck("generation_events", "neurons", "neurons >= 0"),
    c15: ck("generation_events", "cost_jpy", "cost_jpy = 0"),
    c16: ck("generation_events", "consistency_flags", "consistency_flags IS NULL OR json_valid(consistency_flags)"),
    c17: ck("generation_events", "world_time_sec", "world_time_sec >= 0"),
    c18: isoNN("generation_events", "started_at"),
    c19: ck(
      "generation_events",
      "finished_at",
      "(finished_at IS NULL OR length(finished_at) = 24) AND ((status = 'running') = (finished_at IS NULL))",
    ),
    c20: ck("generation_events", "usage_date", "length(usage_date) = 10"),
    idx_gen_world_started: index("idx_gen_world_started").on(t.world_id, sql`started_at DESC`),
    idx_gen_world_agent: index("idx_gen_world_agent").on(t.world_id, t.agent_id, sql`started_at DESC`),
    idx_gen_world_status: index("idx_gen_world_status").on(t.world_id, t.status),
    idx_gen_llm_recent: index("idx_gen_llm_recent").on(t.decided_by, t.status, sql`started_at DESC`),
  }),
);

// ---- 4. posts ----
export const posts = sqliteTable(
  "posts",
  {
    post_id: text("post_id").primaryKey(),
    world_id: text("world_id")
      .notNull()
      .references(() => worlds.world_id),
    agent_id: text("agent_id")
      .notNull()
      .references(() => agents.agent_id),
    body: text("body").notNull(),
    reply_to_post_id: text("reply_to_post_id"),
    root_post_id: text("root_post_id").notNull(),
    depth: integer("depth").notNull(),
    visibility: text("visibility", { enum: POST_VISIBILITIES }).notNull().default("public"),
    world_time_sec: integer("world_time_sec").notNull(),
    created_at: text("created_at").notNull(),
    generation_event_id: text("generation_event_id")
      .notNull()
      .unique()
      .references(() => generation_events.event_id),
  },
  (t) => ({
    c1: ck("posts", "post_id", "length(post_id) = 26"),
    c2: ck("posts", "body", "length(body) BETWEEN 1 AND 140"),
    c3: ck("posts", "root_post_id", "(reply_to_post_id IS NULL) = (root_post_id = post_id)"),
    c4: ck("posts", "depth", "depth >= 0 AND (depth = 0) = (reply_to_post_id IS NULL)"),
    c5: ck("posts", "visibility", `visibility IN (${inList(POST_VISIBILITIES)})`),
    c6: ck("posts", "world_time_sec", "world_time_sec >= 0"),
    c7: isoNN("posts", "created_at"),
    fk_reply_to: foreignKey({ columns: [t.reply_to_post_id], foreignColumns: [t.post_id] }),
    fk_root: foreignKey({ columns: [t.root_post_id], foreignColumns: [t.post_id] }),
    idx_posts_timeline: index("idx_posts_timeline").on(
      t.world_id,
      t.visibility,
      sql`world_time_sec DESC`,
      sql`post_id DESC`,
    ),
    idx_posts_root: index("idx_posts_root").on(t.root_post_id, t.world_time_sec),
    idx_posts_reply_to: index("idx_posts_reply_to").on(t.reply_to_post_id),
    idx_posts_agent: index("idx_posts_agent").on(t.agent_id, sql`world_time_sec DESC`),
    idx_posts_world_created: index("idx_posts_world_created").on(t.world_id, t.created_at),
  }),
);

// ---- 5. likes ----
export const likes = sqliteTable(
  "likes",
  {
    like_id: text("like_id").primaryKey(),
    world_id: text("world_id")
      .notNull()
      .references(() => worlds.world_id),
    agent_id: text("agent_id")
      .notNull()
      .references(() => agents.agent_id),
    post_id: text("post_id")
      .notNull()
      .references(() => posts.post_id),
    world_time_sec: integer("world_time_sec").notNull(),
    created_at: text("created_at").notNull(),
    generation_event_id: text("generation_event_id")
      .notNull()
      .unique()
      .references(() => generation_events.event_id),
  },
  (t) => ({
    c1: ck("likes", "world_time_sec", "world_time_sec >= 0"),
    c2: isoNN("likes", "created_at"),
    ux_likes_agent_post: uniqueIndex("ux_likes_agent_post").on(t.agent_id, t.post_id),
    idx_likes_post: index("idx_likes_post").on(t.post_id),
  }),
);

// ---- 6. follows ----
export const follows = sqliteTable(
  "follows",
  {
    follow_id: text("follow_id").primaryKey(),
    world_id: text("world_id")
      .notNull()
      .references(() => worlds.world_id),
    follower_id: text("follower_id")
      .notNull()
      .references(() => agents.agent_id),
    followee_id: text("followee_id")
      .notNull()
      .references(() => agents.agent_id),
    started_world_sec: integer("started_world_sec").notNull(),
    ended_world_sec: integer("ended_world_sec"),
    start_event_id: text("start_event_id")
      .notNull()
      .references(() => generation_events.event_id),
    end_event_id: text("end_event_id").references(() => generation_events.event_id),
  },
  (t) => ({
    c1: ck("follows", "follower_id", "follower_id <> followee_id"),
    c2: ck("follows", "started_world_sec", "started_world_sec >= 0"),
    c3: ck("follows", "ended_world_sec", "ended_world_sec IS NULL OR ended_world_sec >= started_world_sec"),
    c4: ck("follows", "end_event_id", "(ended_world_sec IS NULL) = (end_event_id IS NULL)"),
    ux_follows_active: uniqueIndex("ux_follows_active")
      .on(t.follower_id, t.followee_id)
      .where(sql`ended_world_sec IS NULL`),
    idx_follows_followee_active: index("idx_follows_followee_active")
      .on(t.followee_id)
      .where(sql`ended_world_sec IS NULL`),
    idx_follows_world: index("idx_follows_world").on(t.world_id, t.started_world_sec),
  }),
);

// ---- 7. memories ----
export const memories = sqliteTable(
  "memories",
  {
    memory_id: text("memory_id").primaryKey(),
    agent_id: text("agent_id")
      .notNull()
      .references(() => agents.agent_id),
    kind: text("kind", { enum: MEMORY_KINDS }).notNull(),
    content: text("content").notNull(),
    updated_at: text("updated_at").notNull(),
  },
  (t) => ({
    c1: ck("memories", "kind", `kind IN (${inList(MEMORY_KINDS)})`),
    c2: ck("memories", "content", "length(content) <= 3000"),
    c3: isoNN("memories", "updated_at"),
    ux_memories_agent_kind: uniqueIndex("ux_memories_agent_kind").on(t.agent_id, t.kind),
  }),
);

// ---- 9. generation_attempts ----
export const generation_attempts = sqliteTable(
  "generation_attempts",
  {
    attempt_id: text("attempt_id").primaryKey(),
    event_id: text("event_id")
      .notNull()
      .references(() => generation_events.event_id),
    attempt_no: integer("attempt_no").notNull(),
    result: text("result", { enum: ATTEMPT_RESULTS }).notNull(),
    http_status: integer("http_status"),
    error_detail: text("error_detail"),
    prompt_tokens: integer("prompt_tokens").notNull().default(0),
    completion_tokens: integer("completion_tokens").notNull().default(0),
    neurons: real("neurons").notNull().default(0),
    duration_ms: integer("duration_ms").notNull(),
    started_at: text("started_at").notNull(),
  },
  (t) => ({
    c1: ck("generation_attempts", "attempt_no", "attempt_no BETWEEN 1 AND 4"),
    c2: ck("generation_attempts", "result", `result IN (${inList(ATTEMPT_RESULTS)})`),
    c3: ck("generation_attempts", "error_detail", "error_detail IS NULL OR length(error_detail) <= 500"),
    c4: ck("generation_attempts", "duration_ms", "duration_ms >= 0"),
    c5: isoNN("generation_attempts", "started_at"),
    ux_attempts_event_no: uniqueIndex("ux_attempts_event_no").on(t.event_id, t.attempt_no),
  }),
);

// ---- 10. hide_records ----
export const hide_records = sqliteTable(
  "hide_records",
  {
    hide_id: text("hide_id").primaryKey(),
    post_id: text("post_id")
      .notNull()
      .references(() => posts.post_id),
    operation: text("operation", { enum: HIDE_OPERATIONS }).notNull(),
    reason: text("reason").notNull().default(""),
    operated_at: text("operated_at").notNull(),
  },
  (t) => ({
    c1: ck("hide_records", "operation", `operation IN (${inList(HIDE_OPERATIONS)})`),
    c2: ck("hide_records", "reason", "length(reason) <= 200"),
    c3: isoNN("hide_records", "operated_at"),
    idx_hide_post: index("idx_hide_post").on(t.post_id, t.operated_at),
    idx_hide_operated: index("idx_hide_operated").on(sql`operated_at DESC`),
  }),
);

// ---- 11. daily_usage ----
export const daily_usage = sqliteTable(
  "daily_usage",
  {
    usage_date: text("usage_date").primaryKey(),
    calls: integer("calls").notNull().default(0),
    runs: integer("runs").notNull().default(0),
    prompt_tokens: integer("prompt_tokens").notNull().default(0),
    completion_tokens: integer("completion_tokens").notNull().default(0),
    neurons: real("neurons").notNull().default(0),
  },
  () => ({
    c1: ck("daily_usage", "usage_date", "length(usage_date) = 10"),
  }),
);

// ---- 12. daily_metrics ----
export const daily_metrics = sqliteTable(
  "daily_metrics",
  {
    world_id: text("world_id")
      .notNull()
      .references(() => worlds.world_id),
    usage_date: text("usage_date").notNull(),
    runs: integer("runs").notNull().default(0),
    posts: integer("posts").notNull().default(0),
    replies: integer("replies").notNull().default(0),
    replied_posts: integer("replied_posts").notNull().default(0),
    likes: integer("likes").notNull().default(0),
    follows: integer("follows").notNull().default(0),
    nones: integer("nones").notNull().default(0),
    failures: integer("failures").notNull().default(0),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.world_id, t.usage_date] }),
    c1: ck("daily_metrics", "usage_date", "length(usage_date) = 10"),
  }),
);

// ---- 13. invitations ----
export const invitations = sqliteTable(
  "invitations",
  {
    invitation_id: text("invitation_id").primaryKey(),
    label: text("label").notNull(),
    token_hash: text("token_hash").notNull().unique(),
    issued_at: text("issued_at").notNull(),
    revoked_at: text("revoked_at"),
    last_used_at: text("last_used_at"),
  },
  () => ({
    c1: ck("invitations", "label", "length(label) BETWEEN 1 AND 30"),
    c2: ck("invitations", "token_hash", "length(token_hash) = 64"),
    c3: isoNN("invitations", "issued_at"),
    c4: isoNull("invitations", "revoked_at"),
    c5: isoNull("invitations", "last_used_at"),
  }),
);

// ---- 14. view_access_logs ----
export const view_access_logs = sqliteTable(
  "view_access_logs",
  {
    log_id: text("log_id").primaryKey(),
    invitation_id: text("invitation_id").references(() => invitations.invitation_id),
    result: text("result", { enum: VIEW_RESULTS }).notNull(),
    accessed_at: text("accessed_at").notNull(),
  },
  () => ({
    c1: ck("view_access_logs", "result", `result IN (${inList(VIEW_RESULTS)})`),
    c2: isoNN("view_access_logs", "accessed_at"),
    idx_view_logs_accessed: index("idx_view_logs_accessed").on(sql`accessed_at DESC`),
  }),
);

// ---- 15. admin_account ----
export const admin_account = sqliteTable(
  "admin_account",
  {
    admin_id: text("admin_id").primaryKey(),
    display_name: text("display_name").notNull(),
    password_hash: text("password_hash").notNull(),
    failed_count: integer("failed_count").notNull().default(0),
    locked_until: text("locked_until"),
    updated_at: text("updated_at").notNull(),
  },
  () => ({
    c1: ck("admin_account", "display_name", "length(display_name) BETWEEN 1 AND 30"),
    c2: ck("admin_account", "failed_count", "failed_count >= 0"),
    c3: isoNN("admin_account", "updated_at"),
    ux_admin_single: uniqueIndex("ux_admin_single").on(sql`(1)`),
  }),
);

// ---- 16. admin_sessions ----
export const admin_sessions = sqliteTable(
  "admin_sessions",
  {
    session_hash: text("session_hash").primaryKey(),
    admin_id: text("admin_id")
      .notNull()
      .references(() => admin_account.admin_id),
    csrf_token: text("csrf_token").notNull(),
    created_at: text("created_at").notNull(),
    last_seen_at: text("last_seen_at").notNull(),
  },
  (t) => ({
    c1: ck("admin_sessions", "session_hash", "length(session_hash) = 64"),
    c2: ck("admin_sessions", "csrf_token", "length(csrf_token) = 43"),
    c3: isoNN("admin_sessions", "created_at"),
    c4: isoNN("admin_sessions", "last_seen_at"),
    idx_sessions_admin: index("idx_sessions_admin").on(t.admin_id),
  }),
);

// ---- 17. admin_audit_logs ----
export const admin_audit_logs = sqliteTable(
  "admin_audit_logs",
  {
    audit_id: text("audit_id").primaryKey(),
    admin_id: text("admin_id")
      .notNull()
      .references(() => admin_account.admin_id),
    operation: text("operation", { enum: AUDIT_OPERATIONS }).notNull(),
    target_type: text("target_type", { enum: AUDIT_TARGET_TYPES }).notNull(),
    target_id: text("target_id"),
    before_json: text("before_json"),
    after_json: text("after_json"),
    world_id: text("world_id").references(() => worlds.world_id),
    operated_at: text("operated_at").notNull(),
  },
  (t) => ({
    c1: ck("admin_audit_logs", "operation", `operation IN (${inList(AUDIT_OPERATIONS)})`),
    c2: ck("admin_audit_logs", "target_type", `target_type IN (${inList(AUDIT_TARGET_TYPES)})`),
    c3: ck("admin_audit_logs", "before_json", "before_json IS NULL OR json_valid(before_json)"),
    c4: ck("admin_audit_logs", "after_json", "after_json IS NULL OR json_valid(after_json)"),
    c5: isoNN("admin_audit_logs", "operated_at"),
    idx_audit_operated: index("idx_audit_operated").on(sql`operated_at DESC`),
    idx_audit_operation: index("idx_audit_operation").on(t.operation, sql`operated_at DESC`),
  }),
);

/** 17 テーブルの物理名（DB 物理設計書 2章の順） */
export const TABLE_NAMES = [
  "worlds",
  "world_settings",
  "agents",
  "posts",
  "likes",
  "follows",
  "memories",
  "generation_events",
  "generation_attempts",
  "hide_records",
  "daily_usage",
  "daily_metrics",
  "invitations",
  "view_access_logs",
  "admin_account",
  "admin_sessions",
  "admin_audit_logs",
] as const;
