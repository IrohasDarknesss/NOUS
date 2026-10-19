-- NOUS DB 物理設計（SQLite 3.45）。docs/design/detailed/_build/db_spec.py が生成する
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE worlds (
  world_id TEXT NOT NULL CHECK (length(world_id) = 26),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 50),
  state TEXT NOT NULL DEFAULT 'preparing' CHECK (state IN ('preparing', 'running', 'paused', 'limit_stopped', 'emergency_stopped', 'archived')),
  stop_reason TEXT CHECK (stop_reason IS NULL OR stop_reason IN ('neurons_limit', 'runs_limit', 'free_tier_error', 'manual_pause', 'emergency')),
  world_elapsed_sec INTEGER NOT NULL DEFAULT 0 CHECK (world_elapsed_sec >= 0),
  running_since TEXT CHECK ((running_since IS NULL OR length(running_since) = 24) AND ((state = 'running') = (running_since IS NOT NULL))),
  heartbeat_at TEXT CHECK ((heartbeat_at IS NULL OR length(heartbeat_at) = 24)),
  cycle_no INTEGER NOT NULL DEFAULT 0 CHECK (cycle_no >= 0),
  next_cycle_at TEXT CHECK ((next_cycle_at IS NULL OR length(next_cycle_at) = 24)),
  created_at TEXT NOT NULL CHECK (length(created_at) = 24),
  started_at TEXT CHECK ((started_at IS NULL OR length(started_at) = 24)),
  archived_at TEXT CHECK ((archived_at IS NULL OR length(archived_at) = 24) AND ((state = 'archived') = (archived_at IS NOT NULL))),
  PRIMARY KEY (world_id)
) STRICT;
CREATE UNIQUE INDEX ux_worlds_current ON worlds ((1)) WHERE state <> 'archived';

CREATE TABLE world_settings (
  world_id TEXT NOT NULL,
  cycle_minutes INTEGER NOT NULL DEFAULT 20 CHECK (cycle_minutes BETWEEN 15 AND 120),
  activity_percent INTEGER NOT NULL DEFAULT 100 CHECK (activity_percent BETWEEN 10 AND 100),
  max_ref_posts INTEGER NOT NULL DEFAULT 12 CHECK (max_ref_posts BETWEEN 1 AND 30),
  max_memory_chars INTEGER NOT NULL DEFAULT 1200 CHECK (max_memory_chars BETWEEN 200 AND 3000),
  max_input_tokens INTEGER NOT NULL DEFAULT 1500 CHECK (max_input_tokens BETWEEN 500 AND 2000),
  max_output_tokens INTEGER NOT NULL DEFAULT 300 CHECK (max_output_tokens BETWEEN 100 AND 400),
  daily_neurons_limit INTEGER NOT NULL DEFAULT 9500 CHECK (daily_neurons_limit BETWEEN 1 AND 10000),
  daily_runs_limit INTEGER NOT NULL DEFAULT 480 CHECK (daily_runs_limit BETWEEN 1 AND 2000),
  max_concurrency INTEGER NOT NULL DEFAULT 1 CHECK (max_concurrency BETWEEN 1 AND 3),
  model_id TEXT NOT NULL DEFAULT '@cf/google/gemma-4-26b-a4b-it' CHECK (model_id IN ('@cf/google/gemma-4-26b-a4b-it', '@cf/qwen/qwen3-30b-a3b-fp8')),
  prompt_version TEXT NOT NULL DEFAULT 'v1' CHECK (length(prompt_version) BETWEEN 1 AND 20),
  updated_at TEXT NOT NULL CHECK (length(updated_at) = 24),
  PRIMARY KEY (world_id),
  FOREIGN KEY (world_id) REFERENCES worlds(world_id)
) STRICT;

CREATE TABLE agents (
  agent_id TEXT NOT NULL CHECK (length(agent_id) = 26),
  world_id TEXT NOT NULL,
  handle TEXT NOT NULL CHECK (length(handle) BETWEEN 3 AND 20 AND handle NOT GLOB '*[^A-Za-z0-9_]*'),
  display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 30),
  bio TEXT NOT NULL DEFAULT '' CHECK (length(bio) <= 200),
  interests TEXT NOT NULL CHECK (length(interests) BETWEEN 1 AND 100),
  topics TEXT NOT NULL CHECK (length(topics) BETWEEN 1 AND 100),
  personality TEXT NOT NULL CHECK (length(personality) BETWEEN 1 AND 100),
  values_text TEXT NOT NULL CHECK (length(values_text) BETWEEN 1 AND 100),
  stance TEXT NOT NULL CHECK (length(stance) BETWEEN 1 AND 100),
  activity_level INTEGER NOT NULL DEFAULT 3 CHECK (activity_level BETWEEN 1 AND 5),
  state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'stopped')),
  created_at TEXT NOT NULL CHECK (length(created_at) = 24),
  updated_at TEXT NOT NULL CHECK (length(updated_at) = 24),
  PRIMARY KEY (agent_id),
  FOREIGN KEY (world_id) REFERENCES worlds(world_id)
) STRICT;
CREATE UNIQUE INDEX ux_agents_world_handle ON agents (world_id, handle);
CREATE INDEX idx_agents_world_state ON agents (world_id, state);

CREATE TABLE generation_events (
  event_id TEXT NOT NULL CHECK (length(event_id) = 26),
  world_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  cycle_no INTEGER NOT NULL CHECK (cycle_no >= 1),
  cycle_seed INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'succeeded', 'failed', 'cancelled', 'interrupted')),
  decided_by TEXT NOT NULL CHECK (decided_by IN ('gate', 'llm')),
  action TEXT CHECK (action IS NULL OR action IN ('post', 'reply', 'like', 'follow', 'unfollow', 'none')),
  failure_kind TEXT CHECK (failure_kind IS NULL OR failure_kind IN ('timeout', 'rate_limited', 'server_error', 'invalid_format', 'free_tier', 'cancelled', 'stopped', 'interrupted')),
  action_candidates TEXT CHECK (action_candidates IS NULL OR json_valid(action_candidates)),
  input_attributes TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(input_attributes)),
  input_memories TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(input_memories)),
  input_post_ids TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(input_post_ids)),
  prompt_text TEXT,
  output_text TEXT,
  model_id TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  llm_mode TEXT NOT NULL CHECK (llm_mode IN ('cloudflare', 'fixed')),
  prompt_tokens INTEGER NOT NULL DEFAULT 0 CHECK (prompt_tokens >= 0),
  completion_tokens INTEGER NOT NULL DEFAULT 0 CHECK (completion_tokens >= 0),
  neurons REAL NOT NULL DEFAULT 0 CHECK (neurons >= 0),
  cost_jpy INTEGER NOT NULL DEFAULT 0 CHECK (cost_jpy = 0),
  consistency_flags TEXT CHECK (consistency_flags IS NULL OR json_valid(consistency_flags)),
  world_time_sec INTEGER NOT NULL CHECK (world_time_sec >= 0),
  started_at TEXT NOT NULL CHECK (length(started_at) = 24),
  finished_at TEXT CHECK ((finished_at IS NULL OR length(finished_at) = 24) AND ((status = 'running') = (finished_at IS NULL))),
  usage_date TEXT NOT NULL CHECK (length(usage_date) = 10),
  PRIMARY KEY (event_id),
  FOREIGN KEY (world_id) REFERENCES worlds(world_id),
  FOREIGN KEY (agent_id) REFERENCES agents(agent_id)
) STRICT;
CREATE INDEX idx_gen_world_started ON generation_events (world_id, started_at DESC);
CREATE INDEX idx_gen_world_agent ON generation_events (world_id, agent_id, started_at DESC);
CREATE INDEX idx_gen_world_status ON generation_events (world_id, status);
CREATE INDEX idx_gen_llm_recent ON generation_events (decided_by, status, started_at DESC);

CREATE TABLE posts (
  post_id TEXT NOT NULL CHECK (length(post_id) = 26),
  world_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 140),
  reply_to_post_id TEXT,
  root_post_id TEXT NOT NULL CHECK ((reply_to_post_id IS NULL) = (root_post_id = post_id)),
  depth INTEGER NOT NULL CHECK (depth >= 0 AND (depth = 0) = (reply_to_post_id IS NULL)),
  visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'hidden')),
  world_time_sec INTEGER NOT NULL CHECK (world_time_sec >= 0),
  created_at TEXT NOT NULL CHECK (length(created_at) = 24),
  generation_event_id TEXT NOT NULL UNIQUE,
  PRIMARY KEY (post_id),
  FOREIGN KEY (world_id) REFERENCES worlds(world_id),
  FOREIGN KEY (agent_id) REFERENCES agents(agent_id),
  FOREIGN KEY (reply_to_post_id) REFERENCES posts(post_id),
  FOREIGN KEY (root_post_id) REFERENCES posts(post_id),
  FOREIGN KEY (generation_event_id) REFERENCES generation_events(event_id)
) STRICT;
CREATE INDEX idx_posts_timeline ON posts (world_id, visibility, world_time_sec DESC, post_id DESC);
CREATE INDEX idx_posts_root ON posts (root_post_id, world_time_sec);
CREATE INDEX idx_posts_reply_to ON posts (reply_to_post_id);
CREATE INDEX idx_posts_agent ON posts (agent_id, world_time_sec DESC);
CREATE INDEX idx_posts_world_created ON posts (world_id, created_at);

CREATE TABLE likes (
  like_id TEXT NOT NULL,
  world_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  post_id TEXT NOT NULL,
  world_time_sec INTEGER NOT NULL CHECK (world_time_sec >= 0),
  created_at TEXT NOT NULL CHECK (length(created_at) = 24),
  generation_event_id TEXT NOT NULL UNIQUE,
  PRIMARY KEY (like_id),
  FOREIGN KEY (world_id) REFERENCES worlds(world_id),
  FOREIGN KEY (agent_id) REFERENCES agents(agent_id),
  FOREIGN KEY (post_id) REFERENCES posts(post_id),
  FOREIGN KEY (generation_event_id) REFERENCES generation_events(event_id)
) STRICT;
CREATE UNIQUE INDEX ux_likes_agent_post ON likes (agent_id, post_id);
CREATE INDEX idx_likes_post ON likes (post_id);

CREATE TABLE follows (
  follow_id TEXT NOT NULL,
  world_id TEXT NOT NULL,
  follower_id TEXT NOT NULL CHECK (follower_id <> followee_id),
  followee_id TEXT NOT NULL,
  started_world_sec INTEGER NOT NULL CHECK (started_world_sec >= 0),
  ended_world_sec INTEGER CHECK (ended_world_sec IS NULL OR ended_world_sec >= started_world_sec),
  start_event_id TEXT NOT NULL,
  end_event_id TEXT CHECK ((ended_world_sec IS NULL) = (end_event_id IS NULL)),
  PRIMARY KEY (follow_id),
  FOREIGN KEY (world_id) REFERENCES worlds(world_id),
  FOREIGN KEY (follower_id) REFERENCES agents(agent_id),
  FOREIGN KEY (followee_id) REFERENCES agents(agent_id),
  FOREIGN KEY (start_event_id) REFERENCES generation_events(event_id),
  FOREIGN KEY (end_event_id) REFERENCES generation_events(event_id)
) STRICT;
CREATE UNIQUE INDEX ux_follows_active ON follows (follower_id, followee_id) WHERE ended_world_sec IS NULL;
CREATE INDEX idx_follows_followee_active ON follows (followee_id) WHERE ended_world_sec IS NULL;
CREATE INDEX idx_follows_world ON follows (world_id, started_world_sec);

CREATE TABLE memories (
  memory_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('interest_profile', 'recent_posts', 'relationship_summary', 'conversation_summary')),
  content TEXT NOT NULL CHECK (length(content) <= 3000),
  updated_at TEXT NOT NULL CHECK (length(updated_at) = 24),
  PRIMARY KEY (memory_id),
  FOREIGN KEY (agent_id) REFERENCES agents(agent_id)
) STRICT;
CREATE UNIQUE INDEX ux_memories_agent_kind ON memories (agent_id, kind);

CREATE TABLE generation_attempts (
  attempt_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  attempt_no INTEGER NOT NULL CHECK (attempt_no BETWEEN 1 AND 4),
  result TEXT NOT NULL CHECK (result IN ('ok', 'timeout', 'rate_limited', 'server_error', 'invalid_format', 'free_tier', 'cancelled')),
  http_status INTEGER,
  error_detail TEXT CHECK (error_detail IS NULL OR length(error_detail) <= 500),
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  neurons REAL NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL CHECK (duration_ms >= 0),
  started_at TEXT NOT NULL CHECK (length(started_at) = 24),
  PRIMARY KEY (attempt_id),
  FOREIGN KEY (event_id) REFERENCES generation_events(event_id)
) STRICT;
CREATE UNIQUE INDEX ux_attempts_event_no ON generation_attempts (event_id, attempt_no);

CREATE TABLE hide_records (
  hide_id TEXT NOT NULL,
  post_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('hide', 'unhide')),
  reason TEXT NOT NULL DEFAULT '' CHECK (length(reason) <= 200),
  operated_at TEXT NOT NULL CHECK (length(operated_at) = 24),
  PRIMARY KEY (hide_id),
  FOREIGN KEY (post_id) REFERENCES posts(post_id)
) STRICT;
CREATE INDEX idx_hide_post ON hide_records (post_id, operated_at);
CREATE INDEX idx_hide_operated ON hide_records (operated_at DESC);

CREATE TABLE daily_usage (
  usage_date TEXT NOT NULL CHECK (length(usage_date) = 10),
  calls INTEGER NOT NULL DEFAULT 0,
  runs INTEGER NOT NULL DEFAULT 0,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  neurons REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (usage_date)
) STRICT;

CREATE TABLE daily_metrics (
  world_id TEXT NOT NULL,
  usage_date TEXT NOT NULL CHECK (length(usage_date) = 10),
  runs INTEGER NOT NULL DEFAULT 0,
  posts INTEGER NOT NULL DEFAULT 0,
  replies INTEGER NOT NULL DEFAULT 0,
  replied_posts INTEGER NOT NULL DEFAULT 0,
  likes INTEGER NOT NULL DEFAULT 0,
  follows INTEGER NOT NULL DEFAULT 0,
  nones INTEGER NOT NULL DEFAULT 0,
  failures INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (world_id, usage_date),
  FOREIGN KEY (world_id) REFERENCES worlds(world_id)
) STRICT;

CREATE TABLE invitations (
  invitation_id TEXT NOT NULL,
  label TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 30),
  token_hash TEXT NOT NULL UNIQUE CHECK (length(token_hash) = 64),
  issued_at TEXT NOT NULL CHECK (length(issued_at) = 24),
  revoked_at TEXT CHECK ((revoked_at IS NULL OR length(revoked_at) = 24)),
  last_used_at TEXT CHECK ((last_used_at IS NULL OR length(last_used_at) = 24)),
  PRIMARY KEY (invitation_id)
) STRICT;

CREATE TABLE view_access_logs (
  log_id TEXT NOT NULL,
  invitation_id TEXT,
  result TEXT NOT NULL CHECK (result IN ('allowed', 'denied')),
  accessed_at TEXT NOT NULL CHECK (length(accessed_at) = 24),
  PRIMARY KEY (log_id),
  FOREIGN KEY (invitation_id) REFERENCES invitations(invitation_id)
) STRICT;
CREATE INDEX idx_view_logs_accessed ON view_access_logs (accessed_at DESC);

CREATE TABLE admin_account (
  admin_id TEXT NOT NULL,
  display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 30),
  password_hash TEXT NOT NULL,
  failed_count INTEGER NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  locked_until TEXT,
  updated_at TEXT NOT NULL CHECK (length(updated_at) = 24),
  PRIMARY KEY (admin_id)
) STRICT;
CREATE UNIQUE INDEX ux_admin_single ON admin_account ((1));

CREATE TABLE admin_sessions (
  session_hash TEXT NOT NULL CHECK (length(session_hash) = 64),
  admin_id TEXT NOT NULL,
  csrf_token TEXT NOT NULL CHECK (length(csrf_token) = 43),
  created_at TEXT NOT NULL CHECK (length(created_at) = 24),
  last_seen_at TEXT NOT NULL CHECK (length(last_seen_at) = 24),
  PRIMARY KEY (session_hash),
  FOREIGN KEY (admin_id) REFERENCES admin_account(admin_id)
) STRICT;
CREATE INDEX idx_sessions_admin ON admin_sessions (admin_id);

CREATE TABLE admin_audit_logs (
  audit_id TEXT NOT NULL,
  admin_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('world.start', 'world.pause', 'world.resume', 'world.emergency_stop', 'world.reset', 'settings.update', 'agent.create', 'agent.update', 'agent.delete', 'agent.stop', 'agent.resume', 'post.hide', 'post.unhide', 'invitation.issue', 'invitation.revoke', 'admin.login', 'admin.logout', 'admin.login_failed')),
  target_type TEXT NOT NULL CHECK (target_type IN ('world', 'agent', 'post', 'invitation', 'settings', 'admin')),
  target_id TEXT,
  before_json TEXT CHECK (before_json IS NULL OR json_valid(before_json)),
  after_json TEXT CHECK (after_json IS NULL OR json_valid(after_json)),
  world_id TEXT,
  operated_at TEXT NOT NULL CHECK (length(operated_at) = 24),
  PRIMARY KEY (audit_id),
  FOREIGN KEY (admin_id) REFERENCES admin_account(admin_id),
  FOREIGN KEY (world_id) REFERENCES worlds(world_id)
) STRICT;
CREATE INDEX idx_audit_operated ON admin_audit_logs (operated_at DESC);
CREATE INDEX idx_audit_operation ON admin_audit_logs (operation, operated_at DESC);

