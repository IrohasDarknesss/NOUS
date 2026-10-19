#!/usr/bin/env python3
"""DB 物理設計書（structure 03）と DDL を、テーブルの定義から生成する。作成：Takaya Ishikawa（NOUS-28）。

使い方: python3 docs/design/detailed/_build/db_spec.py
出力: docs/design/detailed/DB物理設計書.md、docs/design/detailed/schema.sql
"""
import os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.dirname(HERE)
TS = "TEXT"  # ISO 8601 の UTC（例 2026-10-21T09:00:00.000Z）
TS_CHECK = "length({c}) = 24"
ULID = "length({c}) = 26"


def col(logical, name, typ, pk="-", fk="-", nn="○", rule="-", note="-", check=None):
    if name.endswith("_at") or name == "running_since":
        fmt = f"length({name}) = 24" if nn == "○" else f"({name} IS NULL OR length({name}) = 24)"
        check = fmt if not check or check == f"length({name}) = 24" else f"{fmt} AND ({check})"
        rule = "ISO 8601 の UTC（24 字）" if rule == "-" else rule
    return dict(logical=logical, name=name, type=typ, pk=pk, fk=fk, nn=nn, rule=rule, note=note, check=check)


def enum(c, values):
    return f"{c} IN (" + ", ".join(f"'{v}'" for v in values) + ")"


TABLES = [
    dict(logical="世界", name="worlds", domain="世界", summary="世界（AI 社会の1つ）の状態・世界内時間・巡の進み。現在の世界は1つだけで、リセットした世界は archived で残す",
         cols=[
             col("世界ID", "world_id", "TEXT", pk="○", rule="ULID（26 字）", check=ULID),
             col("名前", "name", "TEXT", rule="1〜50 字", note="既定は「世界 YYYY-MM-DD」", check="length(name) BETWEEN 1 AND 50"),
             col("状態", "state", "TEXT", rule="DEFAULT 'preparing'", note="5章のコード", check=enum("state", ["preparing", "running", "paused", "limit_stopped", "emergency_stopped", "archived"])),
             col("停止理由", "stop_reason", "TEXT", nn="-", note="5章のコード", check="stop_reason IS NULL OR " + enum("stop_reason", ["neurons_limit", "runs_limit", "free_tier_error", "manual_pause", "emergency"])),
             col("世界内時間（累計秒）", "world_elapsed_sec", "INTEGER", rule="DEFAULT 0、0 以上", check="world_elapsed_sec >= 0"),
             col("稼働の開始時刻", "running_since", TS, nn="-", note="state が running のときだけ値を持つ", check="(state = 'running') = (running_since IS NOT NULL)"),
             col("生存時刻", "heartbeat_at", TS, nn="-", note="B08 が 60 秒ごとに更新"),
             col("巡の番号", "cycle_no", "INTEGER", rule="DEFAULT 0", check="cycle_no >= 0"),
             col("次の巡の予定", "next_cycle_at", TS, nn="-"),
             col("作成時刻", "created_at", TS, check=TS_CHECK.format(c="created_at")),
             col("開始時刻", "started_at", TS, nn="-"),
             col("アーカイブ時刻", "archived_at", TS, nn="-", check="(state = 'archived') = (archived_at IS NOT NULL)"),
         ],
         indexes=[("ux_worlds_current", "((1)) WHERE state <> 'archived'", "UNIQUE（部分）", "現在の世界（archived 以外）を1つに限る")]),
    dict(logical="実行設定", name="world_settings", domain="世界", summary="世界ごとの周期・上限・モデル。1つの世界に1行",
         cols=[
             col("世界ID", "world_id", "TEXT", pk="○", fk="worlds.world_id"),
             col("周期（分）", "cycle_minutes", "INTEGER", rule="DEFAULT 20、15〜120", check="cycle_minutes BETWEEN 15 AND 120"),
             col("活動量（%）", "activity_percent", "INTEGER", rule="DEFAULT 100、10〜100", check="activity_percent BETWEEN 10 AND 100"),
             col("参照する投稿数の上限", "max_ref_posts", "INTEGER", rule="DEFAULT 12、1〜30", check="max_ref_posts BETWEEN 1 AND 30"),
             col("記憶の文字数の上限", "max_memory_chars", "INTEGER", rule="DEFAULT 1200、200〜3000", check="max_memory_chars BETWEEN 200 AND 3000"),
             col("最大入力トークン", "max_input_tokens", "INTEGER", rule="DEFAULT 1500、500〜2000", check="max_input_tokens BETWEEN 500 AND 2000"),
             col("最大出力トークン", "max_output_tokens", "INTEGER", rule="DEFAULT 300、100〜400", check="max_output_tokens BETWEEN 100 AND 400"),
             col("Neurons の日次上限", "daily_neurons_limit", "INTEGER", rule="DEFAULT 9500、1〜10000", check="daily_neurons_limit BETWEEN 1 AND 10000"),
             col("実行回数の日次上限", "daily_runs_limit", "INTEGER", rule="DEFAULT 480、1〜2000", check="daily_runs_limit BETWEEN 1 AND 2000"),
             col("並列数の上限", "max_concurrency", "INTEGER", rule="DEFAULT 1、1〜3", check="max_concurrency BETWEEN 1 AND 3"),
             col("モデル", "model_id", "TEXT", rule="DEFAULT '@cf/google/gemma-4-26b-a4b-it'", check=enum("model_id", ["@cf/google/gemma-4-26b-a4b-it", "@cf/qwen/qwen3-30b-a3b-fp8"])),
             col("プロンプトの版", "prompt_version", "TEXT", rule="DEFAULT 'v1'", check="length(prompt_version) BETWEEN 1 AND 20"),
             col("更新時刻", "updated_at", TS),
         ], indexes=[]),
    dict(logical="エージェント", name="agents", domain="エージェント", summary="世界の住人の人格・属性・状態",
         cols=[
             col("エージェントID", "agent_id", "TEXT", pk="○", check=ULID.format(c="agent_id")),
             col("世界ID", "world_id", "TEXT", fk="worlds.world_id"),
             col("ハンドル", "handle", "TEXT", rule="3〜20 字、半角英数字と _", note="世界の中で一意", check="length(handle) BETWEEN 3 AND 20 AND handle NOT GLOB '*[^A-Za-z0-9_]*'"),
             col("表示名", "display_name", "TEXT", rule="1〜30 字", check="length(display_name) BETWEEN 1 AND 30"),
             col("自己紹介", "bio", "TEXT", rule="DEFAULT ''、0〜200 字", check="length(bio) <= 200"),
             col("興味", "interests", "TEXT", rule="1〜100 字", check="length(interests) BETWEEN 1 AND 100"),
             col("関心分野", "topics", "TEXT", rule="1〜100 字", check="length(topics) BETWEEN 1 AND 100"),
             col("性格", "personality", "TEXT", rule="1〜100 字", check="length(personality) BETWEEN 1 AND 100"),
             col("価値観", "values_text", "TEXT", rule="1〜100 字", check="length(values_text) BETWEEN 1 AND 100"),
             col("主張傾向", "stance", "TEXT", rule="1〜100 字", check="length(stance) BETWEEN 1 AND 100"),
             col("活動頻度", "activity_level", "INTEGER", rule="DEFAULT 3、1〜5", check="activity_level BETWEEN 1 AND 5"),
             col("状態", "state", "TEXT", rule="DEFAULT 'active'", note="5章のコード", check=enum("state", ["active", "stopped"])),
             col("作成時刻", "created_at", TS),
             col("更新時刻", "updated_at", TS),
         ],
         indexes=[("ux_agents_world_handle", "(world_id, handle)", "UNIQUE", "ハンドルの世界の中での一意（基本設計書 6章）"),
                  ("idx_agents_world_state", "(world_id, state)", "B-Tree", "1巡の対象（稼働中のエージェント）の抽出")]),
    dict(logical="投稿", name="posts", domain="投稿", summary="投稿と返信。生成イベント1件から最大1件",
         cols=[
             col("投稿ID", "post_id", "TEXT", pk="○", check=ULID.format(c="post_id")),
             col("世界ID", "world_id", "TEXT", fk="worlds.world_id"),
             col("投稿者", "agent_id", "TEXT", fk="agents.agent_id"),
             col("本文", "body", "TEXT", rule="1〜140 字", check="length(body) BETWEEN 1 AND 140"),
             col("返信先", "reply_to_post_id", "TEXT", nn="-", fk="posts.post_id", note="新規の投稿では NULL"),
             col("スレッドの起点", "root_post_id", "TEXT", fk="posts.post_id", note="新規の投稿では自分自身", check="(reply_to_post_id IS NULL) = (root_post_id = post_id)"),
             col("深さ", "depth", "INTEGER", rule="0 以上", check="depth >= 0 AND (depth = 0) = (reply_to_post_id IS NULL)"),
             col("公開状態", "visibility", "TEXT", rule="DEFAULT 'public'", note="5章のコード", check=enum("visibility", ["public", "hidden"])),
             col("世界内時間", "world_time_sec", "INTEGER", check="world_time_sec >= 0"),
             col("作成時刻", "created_at", TS),
             col("生成イベント", "generation_event_id", "TEXT", fk="generation_events.event_id", rule="UNIQUE", note="多重の作成を防ぐ（NFR-A-006）"),
         ],
         indexes=[("idx_posts_timeline", "(world_id, visibility, world_time_sec DESC, post_id DESC)", "B-Tree", "タイムライン（GET /api/timeline）のカーソルによるページ送り"),
                  ("idx_posts_root", "(root_post_id, world_time_sec)", "B-Tree", "スレッドの取得"),
                  ("idx_posts_reply_to", "(reply_to_post_id)", "B-Tree", "返信数の集計、返信の有無（応答率）"),
                  ("idx_posts_agent", "(agent_id, world_time_sec DESC)", "B-Tree", "プロフィールの過去投稿、記憶の recent_posts"),
                  ("idx_posts_world_created", "(world_id, created_at)", "B-Tree", "管理画面の投稿の検索、利用日ごとの集計")]),
    dict(logical="いいね", name="likes", domain="投稿", summary="エージェントが付けたいいね",
         cols=[
             col("いいねID", "like_id", "TEXT", pk="○"),
             col("世界ID", "world_id", "TEXT", fk="worlds.world_id"),
             col("付けたエージェント", "agent_id", "TEXT", fk="agents.agent_id"),
             col("対象の投稿", "post_id", "TEXT", fk="posts.post_id", note="自分の投稿は対象にしない（アプリで検査）"),
             col("世界内時間", "world_time_sec", "INTEGER", check="world_time_sec >= 0"),
             col("作成時刻", "created_at", TS),
             col("生成イベント", "generation_event_id", "TEXT", fk="generation_events.event_id", rule="UNIQUE"),
         ],
         indexes=[("ux_likes_agent_post", "(agent_id, post_id)", "UNIQUE", "同じ投稿への重複のいいねを防ぐ"),
                  ("idx_likes_post", "(post_id)", "B-Tree", "いいね数の集計")]),
    dict(logical="フォロー関係", name="follows", domain="関係", summary="フォローの開始と解除。解除しても行を残す",
         cols=[
             col("フォローID", "follow_id", "TEXT", pk="○"),
             col("世界ID", "world_id", "TEXT", fk="worlds.world_id"),
             col("フォローした側", "follower_id", "TEXT", fk="agents.agent_id", check="follower_id <> followee_id"),
             col("フォローされた側", "followee_id", "TEXT", fk="agents.agent_id"),
             col("開始の世界内時間", "started_world_sec", "INTEGER", check="started_world_sec >= 0"),
             col("解除の世界内時間", "ended_world_sec", "INTEGER", nn="-", note="NULL は継続中", check="ended_world_sec IS NULL OR ended_world_sec >= started_world_sec"),
             col("開始の生成イベント", "start_event_id", "TEXT", fk="generation_events.event_id"),
             col("解除の生成イベント", "end_event_id", "TEXT", nn="-", fk="generation_events.event_id", check="(ended_world_sec IS NULL) = (end_event_id IS NULL)"),
         ],
         indexes=[("ux_follows_active", "(follower_id, followee_id) WHERE ended_world_sec IS NULL", "UNIQUE（部分）", "継続中の関係の重複を防ぐ"),
                  ("idx_follows_followee_active", "(followee_id) WHERE ended_world_sec IS NULL", "B-Tree（部分）", "フォロワーの一覧と数"),
                  ("idx_follows_world", "(world_id, started_world_sec)", "B-Tree", "アーカイブの参照、関係の変化の集計")]),
    dict(logical="記憶", name="memories", domain="エージェント", summary="エージェントごと・種類ごとの記憶の要約",
         cols=[
             col("記憶ID", "memory_id", "TEXT", pk="○"),
             col("エージェント", "agent_id", "TEXT", fk="agents.agent_id"),
             col("種類", "kind", "TEXT", note="5章のコード", check=enum("kind", ["interest_profile", "recent_posts", "relationship_summary", "conversation_summary"])),
             col("内容", "content", "TEXT", rule="0〜3000 字", check="length(content) <= 3000"),
             col("更新時刻", "updated_at", TS),
         ],
         indexes=[("ux_memories_agent_kind", "(agent_id, kind)", "UNIQUE", "種類ごとに1行")]),
    dict(logical="生成イベント", name="generation_events", domain="生成", summary="1回の行動機会の記録。入力・出力・利用量・結果",
         cols=[
             col("実行ID", "event_id", "TEXT", pk="○", check=ULID.format(c="event_id")),
             col("世界ID", "world_id", "TEXT", fk="worlds.world_id"),
             col("対象エージェント", "agent_id", "TEXT", fk="agents.agent_id"),
             col("巡の番号", "cycle_no", "INTEGER", check="cycle_no >= 1"),
             col("巡の乱数の種", "cycle_seed", "INTEGER"),
             col("状態", "status", "TEXT", rule="DEFAULT 'running'", note="5章のコード", check=enum("status", ["running", "succeeded", "failed", "cancelled", "interrupted"])),
             col("決めた方法", "decided_by", "TEXT", note="5章のコード", check=enum("decided_by", ["gate", "llm"])),
             col("行動の種類", "action", "TEXT", nn="-", note="5章のコード", check="action IS NULL OR " + enum("action", ["post", "reply", "like", "follow", "unfollow", "none"])),
             col("失敗の種類", "failure_kind", "TEXT", nn="-", note="5章のコード", check="failure_kind IS NULL OR " + enum("failure_kind", ["timeout", "rate_limited", "server_error", "invalid_format", "free_tier", "cancelled", "stopped", "interrupted"])),
             col("行動の候補", "action_candidates", "TEXT", nn="-", note="JSON の配列。gate では NULL", check="action_candidates IS NULL OR json_valid(action_candidates)"),
             col("入力に用いた属性", "input_attributes", "TEXT", rule="DEFAULT '{}'", note="JSON", check="json_valid(input_attributes)"),
             col("入力に用いた記憶", "input_memories", "TEXT", rule="DEFAULT '[]'", note="JSON", check="json_valid(input_memories)"),
             col("参照した投稿", "input_post_ids", "TEXT", rule="DEFAULT '[]'", note="JSON の配列（P 番号の順）", check="json_valid(input_post_ids)"),
             col("入力の全文", "prompt_text", "TEXT", nn="-", note="gate では NULL"),
             col("出力の全文", "output_text", "TEXT", nn="-"),
             col("モデル", "model_id", "TEXT"),
             col("プロンプトの版", "prompt_version", "TEXT"),
             col("LLM のモード", "llm_mode", "TEXT", check=enum("llm_mode", ["cloudflare", "fixed"])),
             col("入力トークン（合計）", "prompt_tokens", "INTEGER", rule="DEFAULT 0", check="prompt_tokens >= 0"),
             col("出力トークン（合計）", "completion_tokens", "INTEGER", rule="DEFAULT 0", check="completion_tokens >= 0"),
             col("Neurons（合計）", "neurons", "REAL", rule="DEFAULT 0", check="neurons >= 0"),
             col("概算費用（円）", "cost_jpy", "INTEGER", rule="DEFAULT 0、常に 0", check="cost_jpy = 0"),
             col("記憶との矛盾の候補", "consistency_flags", "TEXT", nn="-", note="JSON の配列（コード C01〜C04 と内容）", check="consistency_flags IS NULL OR json_valid(consistency_flags)"),
             col("世界内時間", "world_time_sec", "INTEGER", check="world_time_sec >= 0"),
             col("開始時刻", "started_at", TS),
             col("終了時刻", "finished_at", TS, nn="-", check="(status = 'running') = (finished_at IS NULL)"),
             col("利用日", "usage_date", "TEXT", rule="YYYY-MM-DD（UTC）", check="length(usage_date) = 10"),
         ],
         indexes=[("idx_gen_world_started", "(world_id, started_at DESC)", "B-Tree", "生成ログの一覧（P207）"),
                  ("idx_gen_world_agent", "(world_id, agent_id, started_at DESC)", "B-Tree", "エージェントでの絞り込み、直近2回の行動（候補の減点）"),
                  ("idx_gen_world_status", "(world_id, status)", "B-Tree", "状態での絞り込み、起動時の running の後始末（B07）"),
                  ("idx_gen_llm_recent", "(decided_by, status, started_at DESC)", "B-Tree", "直近 50 件の成功した LLM の生成（P205 の見込み、トークンの比の補正）")]),
    dict(logical="生成の試行", name="generation_attempts", domain="生成", summary="LLM の呼び出し1回ごとの結果と利用量",
         cols=[
             col("試行ID", "attempt_id", "TEXT", pk="○"),
             col("実行ID", "event_id", "TEXT", fk="generation_events.event_id"),
             col("試行の番号", "attempt_no", "INTEGER", rule="1〜4", check="attempt_no BETWEEN 1 AND 4"),
             col("結果", "result", "TEXT", note="5章のコード", check=enum("result", ["ok", "timeout", "rate_limited", "server_error", "invalid_format", "free_tier", "cancelled"])),
             col("HTTP の状態", "http_status", "INTEGER", nn="-"),
             col("エラーの内容", "error_detail", "TEXT", nn="-", rule="500 字まで", check="error_detail IS NULL OR length(error_detail) <= 500"),
             col("入力トークン", "prompt_tokens", "INTEGER", rule="DEFAULT 0"),
             col("出力トークン", "completion_tokens", "INTEGER", rule="DEFAULT 0"),
             col("Neurons", "neurons", "REAL", rule="DEFAULT 0"),
             col("所要時間（ミリ秒）", "duration_ms", "INTEGER", check="duration_ms >= 0"),
             col("開始時刻", "started_at", TS),
         ],
         indexes=[("ux_attempts_event_no", "(event_id, attempt_no)", "UNIQUE", "試行の番号の重複を防ぐ。詳細画面の取得")]),
    dict(logical="非表示の記録", name="hide_records", domain="運営", summary="投稿の非表示と取り消しの操作の記録",
         cols=[
             col("記録ID", "hide_id", "TEXT", pk="○"),
             col("対象の投稿", "post_id", "TEXT", fk="posts.post_id"),
             col("操作", "operation", "TEXT", note="5章のコード", check=enum("operation", ["hide", "unhide"])),
             col("理由", "reason", "TEXT", rule="DEFAULT ''、0〜200 字", check="length(reason) <= 200"),
             col("操作時刻", "operated_at", TS),
         ],
         indexes=[("idx_hide_post", "(post_id, operated_at)", "B-Tree", "投稿ごとの履歴"),
                  ("idx_hide_operated", "(operated_at DESC)", "B-Tree", "非表示の履歴の一覧（P209）")]),
    dict(logical="利用日の利用量", name="daily_usage", domain="運営", summary="アカウント単位の利用量。上限の判定に使う",
         cols=[
             col("利用日", "usage_date", "TEXT", pk="○", rule="YYYY-MM-DD（UTC）", check="length(usage_date) = 10"),
             col("呼び出し回数", "calls", "INTEGER", rule="DEFAULT 0"),
             col("生成の回数", "runs", "INTEGER", rule="DEFAULT 0", note="decided_by = llm の生成イベントの数"),
             col("入力トークン", "prompt_tokens", "INTEGER", rule="DEFAULT 0"),
             col("出力トークン", "completion_tokens", "INTEGER", rule="DEFAULT 0"),
             col("Neurons", "neurons", "REAL", rule="DEFAULT 0"),
         ], indexes=[]),
    dict(logical="利用日の運用指標", name="daily_metrics", domain="運営", summary="世界ごと・利用日ごとの運用指標",
         cols=[
             col("世界ID", "world_id", "TEXT", pk="○(1)", fk="worlds.world_id"),
             col("利用日", "usage_date", "TEXT", pk="○(2)", check="length(usage_date) = 10"),
             col("生成の回数", "runs", "INTEGER", rule="DEFAULT 0", note="LLM を呼んだ回数（エラー率の分母）"),
             col("投稿数", "posts", "INTEGER", rule="DEFAULT 0"),
             col("返信数", "replies", "INTEGER", rule="DEFAULT 0"),
             col("返信がついた投稿の数", "replied_posts", "INTEGER", rule="DEFAULT 0"),
             col("いいね数", "likes", "INTEGER", rule="DEFAULT 0"),
             col("フォロー数", "follows", "INTEGER", rule="DEFAULT 0", note="フォローと解除の合計"),
             col("何もしない数", "nones", "INTEGER", rule="DEFAULT 0"),
             col("失敗数", "failures", "INTEGER", rule="DEFAULT 0"),
         ], indexes=[]),
    dict(logical="招待", name="invitations", domain="閲覧", summary="招待リンク。トークンはハッシュだけを保存",
         cols=[
             col("招待ID", "invitation_id", "TEXT", pk="○"),
             col("表示名", "label", "TEXT", rule="1〜30 字", check="length(label) BETWEEN 1 AND 30"),
             col("トークンのハッシュ", "token_hash", "TEXT", rule="UNIQUE、SHA-256 の 16 進 64 字", check="length(token_hash) = 64"),
             col("発行時刻", "issued_at", TS),
             col("失効時刻", "revoked_at", TS, nn="-"),
             col("最終利用時刻", "last_used_at", TS, nn="-"),
         ], indexes=[]),
    dict(logical="閲覧の記録", name="view_access_logs", domain="閲覧", summary="招待リンクを開いた記録（許可・拒否）",
         cols=[
             col("記録ID", "log_id", "TEXT", pk="○"),
             col("招待ID", "invitation_id", "TEXT", nn="-", fk="invitations.invitation_id"),
             col("結果", "result", "TEXT", check=enum("result", ["allowed", "denied"])),
             col("時刻", "accessed_at", TS),
         ],
         indexes=[("idx_view_logs_accessed", "(accessed_at DESC)", "B-Tree", "閲覧の記録の確認")]),
    dict(logical="管理者", name="admin_account", domain="管理", summary="管理者（1名）の認証情報",
         cols=[
             col("管理者ID", "admin_id", "TEXT", pk="○"),
             col("表示名", "display_name", "TEXT", rule="1〜30 字", check="length(display_name) BETWEEN 1 AND 30"),
             col("パスワードのハッシュ", "password_hash", "TEXT", note="scrypt$N$r$p$ソルト$ハッシュ の形"),
             col("連続失敗回数", "failed_count", "INTEGER", rule="DEFAULT 0", check="failed_count >= 0"),
             col("ロック解除時刻", "locked_until", TS, nn="-"),
             col("更新時刻", "updated_at", TS),
         ], indexes=[("ux_admin_single", "((1))", "UNIQUE", "管理者を1行に限る（Q-101 の回答）")]),
    dict(logical="管理セッション", name="admin_sessions", domain="管理", summary="管理画面のセッション。Cookie の値はハッシュで保存",
         cols=[
             col("セッションID のハッシュ", "session_hash", "TEXT", pk="○", check="length(session_hash) = 64"),
             col("管理者ID", "admin_id", "TEXT", fk="admin_account.admin_id"),
             col("CSRF トークン", "csrf_token", "TEXT", rule="43 字（32 バイトの Base64URL）", check="length(csrf_token) = 43"),
             col("作成時刻", "created_at", TS),
             col("最終操作時刻", "last_seen_at", TS),
         ], indexes=[("idx_sessions_admin", "(admin_id)", "B-Tree", "ログアウト・期限切れの一括削除")]),
    dict(logical="管理操作履歴", name="admin_audit_logs", domain="管理", summary="管理者の全操作の記録（NFR-S-008）",
         cols=[
             col("記録ID", "audit_id", "TEXT", pk="○"),
             col("管理者ID", "admin_id", "TEXT", fk="admin_account.admin_id"),
             col("操作の種類", "operation", "TEXT", note="5章のコード", check=enum("operation", ["world.start", "world.pause", "world.resume", "world.emergency_stop", "world.reset", "settings.update", "agent.create", "agent.update", "agent.delete", "agent.stop", "agent.resume", "post.hide", "post.unhide", "invitation.issue", "invitation.revoke", "admin.login", "admin.logout", "admin.login_failed"])),
             col("対象の種類", "target_type", "TEXT", check=enum("target_type", ["world", "agent", "post", "invitation", "settings", "admin"])),
             col("対象の ID", "target_id", "TEXT", nn="-"),
             col("変更前の値", "before_json", "TEXT", nn="-", check="before_json IS NULL OR json_valid(before_json)"),
             col("変更後の値", "after_json", "TEXT", nn="-", check="after_json IS NULL OR json_valid(after_json)"),
             col("世界ID", "world_id", "TEXT", nn="-", fk="worlds.world_id"),
             col("操作時刻", "operated_at", TS),
         ],
         indexes=[("idx_audit_operated", "(operated_at DESC)", "B-Tree", "最近の操作（P202）"),
                  ("idx_audit_operation", "(operation, operated_at DESC)", "B-Tree", "操作の種類での絞り込み")]),
]

CODES = [
    ("worlds", "state", "preparing", "準備中。作成直後とリセット直後。エージェントを登録・編集できる。生成しない"),
    ("worlds", "state", "running", "稼働。開始・再開・日の区切り・上限の引き上げで入る。行動サイクルを実行する"),
    ("worlds", "state", "paused", "一時停止。管理者の操作で入る。生成しない"),
    ("worlds", "state", "limit_stopped", "上限停止。Neurons か実行回数の日次上限、または Cloudflare の 3036 で入る。00:00 UTC か上限の引き上げで running に戻る"),
    ("worlds", "state", "emergency_stopped", "緊急停止。管理者の操作で入り、実行中の生成を取り消す。管理者の再開でだけ戻る"),
    ("worlds", "state", "archived", "アーカイブ。リセットで終了した世界。読み取りだけ"),
    ("worlds", "stop_reason", "neurons_limit", "Neurons の日次上限に達した（limit_stopped）"),
    ("worlds", "stop_reason", "runs_limit", "実行回数の日次上限に達した（limit_stopped）"),
    ("worlds", "stop_reason", "free_tier_error", "Cloudflare が HTTP 429・コード 3036 を返した（limit_stopped）"),
    ("worlds", "stop_reason", "manual_pause", "管理者の一時停止（paused）"),
    ("worlds", "stop_reason", "emergency", "管理者の緊急停止（emergency_stopped）"),
    ("agents", "state", "active", "稼働。行動機会を割り当てる"),
    ("agents", "state", "stopped", "停止。管理者が停止した。行動機会を割り当てないが、過去投稿は表示する"),
    ("posts", "visibility", "public", "公開。生成時の初期値、または非表示の取り消し"),
    ("posts", "visibility", "hidden", "非表示。管理者が非表示にした。観察画面に本文を出さない"),
    ("memories", "kind", "interest_profile", "人格から作る関心のまとめ。登録・編集のときに作り直す"),
    ("memories", "kind", "recent_posts", "最近の自分の行動 5 件と投稿 5 件。成功した行動のたびに更新"),
    ("memories", "kind", "relationship_summary", "相手ごとのフォロー・返信・いいねの回数の要約。成功した行動のたびに更新"),
    ("memories", "kind", "conversation_summary", "直近 3 スレッドの要約。reply のたびに更新"),
    ("generation_events", "status", "running", "実行中。行動機会の開始で作る"),
    ("generation_events", "status", "succeeded", "成功。行動（none を含む）を反映した"),
    ("generation_events", "status", "failed", "失敗。再試行しても失敗、または 3036"),
    ("generation_events", "status", "cancelled", "取り消し。緊急停止、または再試行の待ちの間に世界が止まった"),
    ("generation_events", "status", "interrupted", "中断。プロセスの終了で running のまま残り、起動時（B07）に閉じた"),
    ("generation_events", "decided_by", "gate", "活動頻度による参加の判定で none に決まり、LLM を呼ばなかった"),
    ("generation_events", "decided_by", "llm", "LLM が行動を選んだ"),
    ("generation_events", "action", "post・reply・like・follow・unfollow・none", "選ばれた行動（行動生成とプロンプトの設計 6.1）。失敗では NULL"),
    ("generation_events", "failure_kind", "timeout・rate_limited・server_error", "一時的な失敗。最大2回の再試行の後も失敗"),
    ("generation_events", "failure_kind", "invalid_format", "出力の取り出し・検証に失敗し、再生成でも失敗"),
    ("generation_events", "failure_kind", "free_tier", "HTTP 429・コード 3036"),
    ("generation_events", "failure_kind", "cancelled・stopped・interrupted", "緊急停止による取り消し・世界の停止による打ち切り・プロセスの終了"),
    ("generation_attempts", "result", "ok・timeout・rate_limited・server_error・invalid_format・free_tier・cancelled", "1回の呼び出しの結果"),
    ("hide_records", "operation", "hide・unhide", "非表示にした・取り消した"),
    ("view_access_logs", "result", "allowed・denied", "招待リンクの照合に成功した・失敗した"),
    ("admin_audit_logs", "operation", "world.* ・settings.update・agent.*・post.*・invitation.*・admin.*", "管理操作の種類（基本設計書 6章の 18 種）"),
]


def ddl():
    out = ["-- NOUS DB 物理設計（SQLite 3.45）。docs/design/detailed/_build/db_spec.py が生成する", "PRAGMA foreign_keys = ON;", "PRAGMA journal_mode = WAL;", ""]
    order = ["worlds", "world_settings", "agents", "generation_events", "posts", "likes", "follows", "memories", "generation_attempts", "hide_records", "daily_usage", "daily_metrics", "invitations", "view_access_logs", "admin_account", "admin_sessions", "admin_audit_logs"]
    by = {t["name"]: t for t in TABLES}
    for name in order:
        t = by[name]
        lines = []
        pks = [c["name"] for c in t["cols"] if c["pk"].startswith("○")]
        for c in t["cols"]:
            s = f"  {c['name']} {c['type']}"
            if c["nn"] == "○":
                s += " NOT NULL"
            r = c["rule"]
            if "DEFAULT " in r:
                d = r.split("DEFAULT ")[1].split("、")[0]
                s += f" DEFAULT {d}"
            if "UNIQUE" in r and len(pks) <= 1:
                s += " UNIQUE"
            if c["check"]:
                chk = c["check"].format(c=c["name"]) if "{c}" in c["check"] else c["check"]
                s += f" CHECK ({chk})"
            lines.append(s)
        lines.append(f"  PRIMARY KEY ({', '.join(pks)})")
        for c in t["cols"]:
            if c["fk"] != "-":
                rt, rc = c["fk"].split(".")
                lines.append(f"  FOREIGN KEY ({c['name']}) REFERENCES {rt}({rc})")
        out.append(f"CREATE TABLE {name} (\n" + ",\n".join(lines) + "\n) STRICT;")
        for iname, cols, kind, _ in t["indexes"]:
            u = "UNIQUE " if kind.startswith("UNIQUE") else ""
            if cols.startswith("((1))"):
                out.append(f"CREATE {u}INDEX {iname} ON {name} ((1)){cols[5:]};")
            else:
                out.append(f"CREATE {u}INDEX {iname} ON {name} {cols};")
        out.append("")
    return "\n".join(out)


def md(sql):
    L = ["# NOUS DB 物理設計書", "",
         "| 項目 | 内容 |", "|---|---|",
         "| 文書番号 | DD-NOUS-DB |", "| 版数 | v1.1 |", "| 作成日 | 2026-10-21 |",
         "| 作成者 | Takaya Ishikawa（開発担当） |", "| レビュー担当 | Kouhei Tajima（再鑑担当） |",
         "| 入力 | 基本設計書（概要）v3.5 6章（論理テーブル 17）、行動生成とプロンプトの設計 v1.4 |",
         "| 関連チケット | NOUS-28 |", "",
         "## 改訂履歴", "", "| 版数 | 日付 | 変更内容 | 変更者 |", "|---|---|---|---|",
         "| v1 | 2026-10-21 | 初版作成 | Takaya Ishikawa |", "| v1.1 | 2026-10-21 | 第1回レビューの指摘（m-01）の反映。時刻のカラムすべてに形式の検査を追加 | Takaya Ishikawa |", "", "---", "",
         "## 1. データベース概要", "",
         "* **対象RDBMS**: SQLite 3.45 以降（better-sqlite3 11 に同梱）。テーブルは STRICT（型の厳格な検査）で作る",
         "* **文字コード / 照合順序**: UTF-8 / BINARY（既定）。日本語の部分一致の検索（管理画面の投稿の検索）は LIKE で行う",
         "* **命名規則**: テーブル名は小文字のスネークケースの複数形（設定の 1 行のテーブルは単数：world_settings・admin_account）。カラム名は小文字のスネークケース。インデックスは一意が ux_、通常が idx_ で始め、テーブルの略称と列を続ける",
         "* **共通カラム規約**: ID は ULID（26 字の TEXT。アプリで採番し、時刻順に並ぶ）。時刻は ISO 8601 の UTC の TEXT（24 字、例 2026-10-21T09:00:00.000Z）。世界内時間は世界の開始からの秒の INTEGER。JSON は TEXT に入れ json_valid() で検査する。論理削除は行わない（データを消すのは準備中の世界のエージェントの削除だけ）",
         "* **接続の設定**: 接続時に PRAGMA foreign_keys = ON、journal_mode = WAL、busy_timeout = 5000 を設定する。WAL により、生成の書き込み中も閲覧の読み取りを止めない（NFR-P-005）",
         "* **Drizzle のスキーマとの対応**: apps/server/src/db/schema.ts のテーブル名・カラム名は本書の物理名と同じにする（camelCase への変換は API の層で行う）", ""]
    L += ["## 2. 物理テーブル一覧", "", "| No | 論理名 | 物理名 | ドメイン | 概要 |", "| :--- | :--- | :--- | :--- | :--- |"]
    for i, t in enumerate(TABLES, 1):
        L.append(f"| {i} | {t['logical']} | {t['name']} | {t['domain']} | {t['summary']} |")
    L += ["", "## 3. テーブル詳細定義", ""]
    for t in TABLES:
        L += [f"### テーブル名: {t['logical']} (`{t['name']}`)", "", f"* **概要**: {t['summary']}", f"* **対応ドメイン**: {t['domain']}", "",
              "| カラム論理名 | カラム物理名 | データ型 | PK | FK | 必須 (NN) | デフォルト値 / 制約 | 備考 |", "| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |"]
        for c in t["cols"]:
            chk = ""
            if c["check"]:
                chk = "CHECK: " + (c["check"].format(c=c["name"]) if "{c}" in c["check"] else c["check"])
            rule = c["rule"] if c["rule"] != "-" else ""
            rc = "、".join(x for x in [rule, chk.replace("|", "｜")] if x) or "-"
            L.append(f"| {c['logical']} | {c['name']} | {c['type']} | {c['pk']} | {c['fk']} | {c['nn']} | {rc} | {c['note']} |")
        L.append("")
    L += ["## 4. インデックス設計", "", "| 対象テーブル物理名 | インデックス名 | 対象カラム | 種別 | 目的・理由 |", "| :--- | :--- | :--- | :--- | :--- |"]
    for t in TABLES:
        for iname, cols, kind, why in t["indexes"]:
            L.append(f"| {t['name']} | {iname} | {cols} | {kind} | {why} |")
    L += ["", "外部キーの列のうち、上の表にない列（例 likes.world_id）は、その列だけで検索しないため、インデックスを作らない。世界の数は少なく（リセットの回数だけ）、world_id だけの絞り込みは、複合のインデックスの先頭の列で足りる。", ""]
    L += ["## 5. コード定義（区分値・ステータス定義）", "", "| 対象テーブル | 対象カラム | 設定値 | 意味・遷移条件 |", "| :--- | :--- | :--- | :--- |"]
    L += [f"| {a} | {b} | {c} | {d} |" for a, b, c, d in CODES]
    L += ["", "状態の遷移の条件の全体は、基本設計書（概要）6章「状態の遷移」に従う。区分値はすべて CHECK 制約で DB でも検査する。", ""]
    L += ["## 6. DDL (データ定義言語)", "", "```sql", sql.rstrip(), "```", ""]
    L += ["## 7. マイグレーション計画（該当する場合のみ）", "", "該当なし（新規構築）。初期のマイグレーションは drizzle-kit で本 DDL と同じ内容を 0000_init として作り、`pnpm db:migrate` で適用する。以後の変更は、マイグレーションのファイルを追加し、本書の改訂履歴に記録する。", "",
          "| No | 対象テーブル | 変更種別 | 変更内容 | 影響範囲 | 備考 |", "| :--- | :--- | :--- | :--- | :--- | :--- |",
          "| 1 | 全テーブル | 新規作成 | 0000_init（本書 6章の DDL） | 全機能 | 新規構築 |", ""]
    return "\n".join(L)


if __name__ == "__main__":
    sql = ddl()
    open(os.path.join(OUT, "schema.sql"), "w", encoding="utf-8").write(sql + "\n")
    open(os.path.join(OUT, "DB物理設計書.md"), "w", encoding="utf-8").write(md(sql))
    print("tables", len(TABLES), "indexes", sum(len(t["indexes"]) for t in TABLES))
