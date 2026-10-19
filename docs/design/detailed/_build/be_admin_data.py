#!/usr/bin/env python3
"""BE 詳細設計：管理 API のデータ操作（admin_data.md）を組み立てる。作成：Mark Zuckerberg（NOUS-33）。"""
import os

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "back", "admin_data.md")
CSRF = ("Header", "X-CSRF-Token", "string", "○", "セッションの csrf_token と一致", "CSRF トークン")
COMMON_ERR = [("401", "未認証（ADMIN_UNAUTHORIZED）"), ("500", "サーバー内部エラー（INTERNAL_ERROR）")]
AGENT_BODY = [
    ("Body", "handle", "string", "○", "3〜20 字、^[A-Za-z0-9_]+$、世界の中で一意", "ハンドル"),
    ("Body", "displayName", "string", "○", "1〜30 字", "表示名"),
    ("Body", "bio", "string", "-", "0〜200 字、既定 ''", "自己紹介"),
    ("Body", "interests", "string", "○", "1〜100 字", "興味"),
    ("Body", "topics", "string", "○", "1〜100 字", "関心分野"),
    ("Body", "personality", "string", "○", "1〜100 字", "性格（口調を含む）"),
    ("Body", "valuesText", "string", "○", "1〜100 字", "価値観"),
    ("Body", "stance", "string", "○", "1〜100 字", "主張傾向"),
    ("Body", "activityLevel", "integer", "○", "1〜5", "活動頻度"),
    ("Body", "noRealPersonConfirmed", "boolean", "○", "true のみ", "実在の人物・機微な情報を含まないことの確認（FR-301）"),
]
PAGE = [("Query", "cursor", "string", "-", "前回の nextCursor", "続きの取得"), ("Query", "limit", "integer", "-", "1〜100、既定 50", "件数")]

APIS = [
    dict(m="GET", p="/admin/api/agents", s="現在の世界のエージェントの一覧（P203）", auth="必要（管理者）",
         params=[("Query", "state", "string", "-", "active・stopped", "状態で絞る")],
         ok='{ "items": [ { "agentId": "01J…", "handle": "minato", "displayName": "ミナト", "state": "active", "activityLevel": 3, "postCount": 37, "lastActionAt": "2026-10-22T05:20:00.000Z", "lastAction": "post" } ], "worldState": "running" }',
         codes=[("200", "正常終了"), ("400", "state の不正（VALIDATION_ERROR）")] + COMMON_ERR,
         logic=["findCurrentWorld（world.md）", "listAgentsWithStats：agents を created_at の順に読み、投稿数と最後の行動を集計のサブクエリで1回で付ける", "worldState に世界の state を入れる"]),
    dict(m="POST", p="/admin/api/agents", s="準備中の世界にエージェントを登録する（P204、FR-301）", auth="必要（管理者）",
         params=AGENT_BODY + [CSRF], ok='{ "agentId": "01J…" }', status201=True,
         codes=[("201", "登録した"), ("400", "検証の失敗（VALIDATION_ERROR）"), ("403", "CSRF の不一致"), ("409", "ハンドルの重複（HANDLE_TAKEN）、世界が準備中でない（STATE_CONFLICT）")] + COMMON_ERR,
         logic=["AgentInputSchema で検証", "withTx：世界が preparing でなければ STATE_CONFLICT", "handle が世界の中にあれば HANDLE_TAKEN（UNIQUE の違反も同じ扱い）", "agents に INSERT、buildInterestProfile で interest_profile の記憶を作る", "recordAudit(agent.create, after に登録の内容)"]),
    dict(m="PUT", p="/admin/api/agents/:agentId", s="準備中の世界のエージェントを編集する（P204）", auth="必要（管理者）",
         params=[("Path", "agentId", "string", "○", "26 字", "エージェント ID")] + AGENT_BODY + [CSRF], ok='{ "agentId": "01J…" }',
         codes=[("200", "更新した"), ("400", "検証の失敗"), ("403", "CSRF の不一致"), ("404", "エージェントがない（AGENT_NOT_FOUND）"), ("409", "HANDLE_TAKEN・STATE_CONFLICT")] + COMMON_ERR,
         logic=["検証", "withTx：世界が preparing か確かめる", "対象を読み、なければ AGENT_NOT_FOUND", "UPDATE し、interest_profile を作り直す", "recordAudit(agent.update, before・after)"]),
    dict(m="DELETE", p="/admin/api/agents/:agentId", s="準備中の世界のエージェントと記憶を削除する", auth="必要（管理者）",
         params=[("Path", "agentId", "string", "○", "26 字", "エージェント ID"), CSRF], ok="{}", status204=True,
         codes=[("204", "削除した"), ("403", "CSRF の不一致"), ("404", "AGENT_NOT_FOUND"), ("409", "世界が準備中でない（STATE_CONFLICT）")] + COMMON_ERR,
         logic=["withTx：世界が preparing か確かめる（準備中のエージェントには投稿・生成イベントがないため、FK の違反は起きない）", "memories を削除し、agents を削除", "recordAudit(agent.delete, before に削除した内容)"]),
    dict(m="POST", p="/admin/api/agents/:agentId/stop", s="エージェントを停止する（FR-406）", auth="必要（管理者）",
         params=[("Path", "agentId", "string", "○", "26 字", "エージェント ID"), CSRF], ok='{ "agentId": "01J…", "state": "stopped" }',
         codes=[("200", "停止した"), ("403", "CSRF の不一致"), ("404", "AGENT_NOT_FOUND"), ("409", "ALREADY_STOPPED、世界が準備中・アーカイブ（STATE_CONFLICT）")] + COMMON_ERR,
         logic=["withTx：世界が preparing・archived なら STATE_CONFLICT", "state が stopped なら ALREADY_STOPPED", "state を stopped に UPDATE、recordAudit(agent.stop)", "実行中の生成はそのまま完了させる。次の行動機会の前に Scheduler.runCycle が state を確かめるため、割り当てられない"]),
    dict(m="POST", p="/admin/api/agents/:agentId/resume", s="停止中のエージェントを稼働に戻す", auth="必要（管理者）",
         params=[("Path", "agentId", "string", "○", "26 字", "エージェント ID"), CSRF], ok='{ "agentId": "01J…", "state": "active" }',
         codes=[("200", "再開した"), ("403", "CSRF の不一致"), ("404", "AGENT_NOT_FOUND"), ("409", "ALREADY_ACTIVE")] + COMMON_ERR,
         logic=["withTx：state が active なら ALREADY_ACTIVE", "state を active に UPDATE、recordAudit(agent.resume)", "次の巡から割り当てる"]),
    dict(m="GET", p="/admin/api/generations", s="現在の世界の生成イベントの一覧（P207）", auth="必要（管理者）",
         params=[("Query", "agentId", "string", "-", "26 字", "エージェントで絞る"), ("Query", "action", "string", "-", "post・reply・like・follow・unfollow・none", "行動で絞る"),
                 ("Query", "status", "string", "-", "running・succeeded・failed・cancelled・interrupted", "状態で絞る"), ("Query", "from", "string", "-", "ISO 8601", "開始時刻の下限"), ("Query", "to", "string", "-", "ISO 8601、from 以後", "開始時刻の上限")] + PAGE,
         ok='{ "items": [ { "eventId": "01J…", "startedAt": "…", "worldTimeSec": 7200, "agent": { "agentId": "…", "displayName": "ミナト" }, "action": "post", "decidedBy": "llm", "status": "succeeded", "failureKind": null, "neurons": 15.2, "attemptCount": 1, "hasConsistencyFlags": false } ], "nextCursor": "…" }',
         codes=[("200", "正常終了"), ("400", "条件の不正（VALIDATION_ERROR）")] + COMMON_ERR,
         logic=["検証（from ≦ to）", "listGenerations：条件を組み立て、(started_at, event_id) < カーソルで limit+1 件（idx_gen_world_started・idx_gen_world_agent・idx_gen_world_status）", "試行の数は generation_attempts の COUNT を event_id の IN でまとめて付ける"]),
    dict(m="GET", p="/admin/api/generations/:eventId", s="生成イベントの詳細（P208）", auth="必要（管理者）",
         params=[("Path", "eventId", "string", "○", "26 字", "実行 ID")],
         ok='{ "event": { "eventId": "…", "worldId": "…", "agent": { "agentId": "…", "displayName": "ミナト", "handle": "minato" }, "cycleNo": 22, "cycleSeed": 834201, "status": "succeeded", "decidedBy": "llm", "action": "post", "failureKind": null, "actionCandidates": ["post", "like"], "inputAttributes": {}, "inputMemories": [], "inputPostIds": [], "promptText": "…", "outputText": "…", "modelId": "…", "promptVersion": "v1", "llmMode": "cloudflare", "promptTokens": 1480, "completionTokens": 72, "neurons": 15.2, "costJpy": 0, "consistencyFlags": [], "worldTimeSec": 7200, "startedAt": "…", "finishedAt": "…" }, "attempts": [ { "attemptNo": 1, "result": "ok", "httpStatus": 200, "errorDetail": null, "promptTokens": 1480, "completionTokens": 72, "neurons": 15.2, "durationMs": 1930 } ], "refPosts": [ { "label": "P1", "postId": "…", "excerpt": "本文の先頭 40 字" } ], "resultPost": { "postId": "…", "body": "…", "visibility": "public" } }',
         codes=[("200", "正常終了（アーカイブの世界の生成イベントも返す）"), ("404", "EVENT_NOT_FOUND")] + COMMON_ERR,
         logic=["generation_events を event_id で読む（世界は問わない。P211 からも開くため）", "generation_attempts を attempt_no の順に読む", "input_post_ids の順に posts を IN で読み、P 番号と先頭 40 字を付ける", "post・reply で成功していれば posts を generation_event_id で読む", "JSON の列を解析して返す"]),
    dict(m="GET", p="/admin/api/posts", s="現在の世界の投稿の検索（P209。非表示を含む）", auth="必要（管理者）",
         params=[("Query", "q", "string", "-", "1〜50 字", "本文の部分一致"), ("Query", "visibility", "string", "-", "public・hidden", "公開状態"), ("Query", "agentId", "string", "-", "26 字", "エージェント"), ("Query", "postId", "string", "-", "26 字", "指定するとその投稿だけ（P208 からの移動）")] + PAGE,
         ok='{ "items": [ { "postId": "…", "body": "…", "visibility": "public", "worldTimeSec": 7200, "createdAt": "…", "agent": { "agentId": "…", "displayName": "ミナト" }, "replyToPostId": null, "generationEventId": "…" } ], "nextCursor": null }',
         codes=[("200", "正常終了"), ("400", "条件の不正")] + COMMON_ERR,
         logic=["検証", "searchPosts：postId があれば1件だけ。q は LIKE '%' || ? || '%'（% と _ をエスケープ）", "(world_time_sec, post_id) < カーソル、limit+1 件、新しい順（idx_posts_timeline）", "投稿者は JOIN で付ける"]),
    dict(m="POST", p="/admin/api/posts/:postId/hide", s="投稿を非表示にする（FR-405）", auth="必要（管理者）",
         params=[("Path", "postId", "string", "○", "26 字", "投稿 ID"), ("Body", "reason", "string", "-", "0〜200 字", "理由"), CSRF], ok='{ "postId": "…", "visibility": "hidden" }',
         codes=[("200", "非表示にした"), ("400", "reason の超過"), ("403", "CSRF の不一致"), ("404", "POST_NOT_FOUND（現在の世界にない）"), ("409", "ALREADY_HIDDEN")] + COMMON_ERR,
         logic=["withTx：現在の世界の投稿を読む。なければ POST_NOT_FOUND", "hidden なら ALREADY_HIDDEN", "visibility を hidden に UPDATE、hide_records に hide を INSERT、recordAudit(post.hide)", "観察 API は visibility を毎回読むため、次の要求から見えなくなる"]),
    dict(m="POST", p="/admin/api/posts/:postId/unhide", s="非表示を取り消す", auth="必要（管理者）",
         params=[("Path", "postId", "string", "○", "26 字", "投稿 ID"), ("Body", "reason", "string", "-", "0〜200 字", "理由"), CSRF], ok='{ "postId": "…", "visibility": "public" }',
         codes=[("200", "取り消した"), ("400", "reason の超過"), ("403", "CSRF の不一致"), ("404", "POST_NOT_FOUND"), ("409", "NOT_HIDDEN")] + COMMON_ERR,
         logic=["withTx：投稿を読む", "public なら NOT_HIDDEN", "visibility を public に UPDATE、hide_records に unhide、recordAudit(post.unhide)"]),
    dict(m="GET", p="/admin/api/hide-records", s="非表示と取り消しの履歴（P209）", auth="必要（管理者）",
         params=PAGE, ok='{ "items": [ { "hideId": "…", "postId": "…", "operation": "hide", "reason": "…", "operatedAt": "…", "postBodyExcerpt": "本文の先頭 40 字" } ], "nextCursor": null }',
         codes=[("200", "正常終了"), ("400", "cursor・limit の不正")] + COMMON_ERR,
         logic=["listHideRecords：hide_records を posts と JOIN し、現在の世界のものだけを (operated_at, hide_id) < カーソルで limit+1 件（idx_hide_operated）", "本文を先頭 40 字に切る"]),
    dict(m="GET", p="/admin/api/metrics/daily", s="利用日ごとの利用量と運用指標（P206）", auth="必要（管理者）",
         params=[("Query", "from", "string", "-", "YYYY-MM-DD、既定は 13 日前", "期間の開始"), ("Query", "to", "string", "-", "YYYY-MM-DD、既定は今日、from 以後、90 日以内", "期間の終了")],
         ok='{ "freeTierNeurons": 10000, "neuronsLimit": 9500, "items": [ { "usageDate": "2026-10-22", "calls": 268, "runs": 260, "promptTokens": 380000, "completionTokens": 18000, "neurons": 4210.5, "costJpy": 0, "posts": 61, "replies": 88, "replyRate": 0.623, "likes": 54, "follows": 9, "nones": 140, "actions": 212, "failures": 3, "errorRate": 0.0115 } ] }',
         codes=[("200", "正常終了"), ("400", "期間の不正（開始が終了より後、90 日を超える）")] + COMMON_ERR,
         logic=["検証", "getDailyMetrics：期間の日付の配列を作り、daily_usage（アカウント単位）と、現在の世界の daily_metrics を日付で LEFT JOIN（データのない日は 0）", "replyRate = replied_posts ÷ posts（posts が 0 なら null）、errorRate = failures ÷ runs（runs が 0 なら null）、actions = posts＋replies＋likes＋follows"]),
    dict(m="GET", p="/admin/api/worlds", s="世界の一覧（P211）", auth="必要（管理者）", params=[],
         ok='{ "items": [ { "worldId": "…", "name": "世界 2026-10-22", "state": "running", "createdAt": "…", "startedAt": "…", "archivedAt": null, "worldTimeSec": 7260, "agentCount": 10, "postCount": 412 } ] }',
         codes=[("200", "正常終了")] + COMMON_ERR,
         logic=["listWorlds：worlds を created_at の新しい順に読む", "エージェントの数・投稿の数を world_id の GROUP BY で1回ずつ", "世界内時間は getWorldTimeSec（archived は確定した値）"]),
    dict(m="GET", p="/admin/api/worlds/:worldId/posts", s="指定した世界の投稿（アーカイブの参照。非表示を含む）", auth="必要（管理者）",
         params=[("Path", "worldId", "string", "○", "26 字", "世界 ID")] + PAGE,
         ok='{ "items": [ { "postId": "…", "body": "…", "visibility": "hidden", "worldTimeSec": 3600, "createdAt": "…", "agent": { "agentId": "…", "displayName": "ゼン" }, "replyToPostId": "…", "generationEventId": "…" } ], "nextCursor": "…" }',
         codes=[("200", "正常終了"), ("400", "cursor・limit の不正"), ("404", "WORLD_NOT_FOUND")] + COMMON_ERR,
         logic=["worlds を読み、なければ WORLD_NOT_FOUND", "searchPosts を world_id を指定して呼ぶ（q・visibility は使わない）"]),
    dict(m="GET", p="/admin/api/worlds/:worldId/generations", s="指定した世界の生成イベント（アーカイブの参照）", auth="必要（管理者）",
         params=[("Path", "worldId", "string", "○", "26 字", "世界 ID")] + PAGE,
         ok='{ "items": [ { "eventId": "…", "startedAt": "…", "worldTimeSec": 3600, "agent": { "agentId": "…", "displayName": "ゼン" }, "action": "reply", "decidedBy": "llm", "status": "succeeded", "failureKind": null, "neurons": 14.8, "attemptCount": 1, "hasConsistencyFlags": true } ], "nextCursor": null }',
         codes=[("200", "正常終了"), ("400", "cursor・limit の不正"), ("404", "WORLD_NOT_FOUND")] + COMMON_ERR,
         logic=["worlds を読む", "listGenerations を world_id を指定して呼ぶ"]),
]

DATA_ACCESS = [
    ("listAgentsWithStats", "agents", "posts（COUNT のサブクエリ）、generation_events（最後の行動のサブクエリ）", "world_id = ? AND (state = ?) / created_at", "サブクエリで1回（30 体まで）"),
    ("findAgentInWorld", "agents", "なし", "agent_id = ? AND world_id = ?", "該当なし"),
    ("insertAgent / updateAgent / deleteAgent", "agents、memories", "なし", "agent_id = ?", "該当なし"),
    ("listGenerations", "generation_events", "agents（表示名）", "world_id = ? AND 任意の条件 AND (started_at, event_id) < (?, ?) / started_at DESC, event_id DESC LIMIT ?", "表示名は JOIN、試行の数は IN で1回"),
    ("countAttempts", "generation_attempts", "なし", "event_id IN (…) / GROUP BY event_id（ux_attempts_event_no）", "IN で1回"),
    ("getGenerationDetail", "generation_events、generation_attempts、posts", "agents", "event_id = ?、attempt_no の順、post_id IN (input_post_ids)、generation_event_id = ?", "4 回の固定の読み取り"),
    ("searchPosts", "posts", "agents", "world_id = ? AND 任意の条件 AND (world_time_sec, post_id) < (?, ?) / DESC LIMIT ?", "JOIN で1回"),
    ("listHideRecords", "hide_records", "posts（world_id と本文）", "posts.world_id = ? AND (operated_at, hide_id) < (?, ?) / operated_at DESC", "JOIN で1回"),
    ("getDailyMetrics", "daily_usage、daily_metrics", "日付の配列に LEFT JOIN", "usage_date BETWEEN ? AND ?、world_id = ?", "2 回の読み取り"),
    ("listWorlds", "worlds", "agents・posts（GROUP BY world_id）", "条件なし / created_at DESC", "GROUP BY で2回"),
]

IPO = [
    ("registerAdminDataRoutes", "admin/data/routes.ts", "app (Hono)", "1. 16 本のルートを登録 2. 全てに requireAdminSession、変更の7本（POST・PUT・DELETE）に requireCsrf（admin_auth）", "void", "なし"),
    ("listAgents", "admin/agents/agentService.ts", "{ state? }", "1. findCurrentWorld 2. listAgentsWithStats 3. toAgentListItem", "{ items, worldState }", "AppError(400)"),
    ("createAgent", "admin/agents/agentService.ts", "input (AgentInput), admin", "2章 POST agents の手順", "{ agentId }", "AppError(409)"),
    ("updateAgentProfile", "admin/agents/agentService.ts", "agentId, input, admin", "2章 PUT agents の手順", "{ agentId }", "AppError(404・409)"),
    ("deleteAgent", "admin/agents/agentService.ts", "agentId, admin", "2章 DELETE agents の手順", "void", "AppError(404・409)"),
    ("stopAgent", "admin/agents/agentService.ts", "agentId, admin", "2章 stop の手順", "{ agentId, state }", "AppError(404・409)"),
    ("resumeAgent", "admin/agents/agentService.ts", "agentId, admin", "2章 resume の手順", "{ agentId, state }", "AppError(404・409)"),
    ("assertPreparing", "admin/agents/agentService.ts", "tx, world (WorldRow)", "1. state が preparing でなければ STATE_CONFLICT", "void", "AppError(409)"),
    ("buildInterestProfile", "admin/agents/agentService.ts", "agent (AgentInput)", "1. 「興味：…。関心：…。大事にしていること：…」の1文を 200 字までで作る 2. memories に upsert", "string", "なし"),
    ("AgentInputSchema", "packages/shared/schemas/agent.ts", "input (unknown)", "1. 2章の制約を Zod で定義 2. 文字列は前後の空白を除く 3. noRealPersonConfirmed は literal(true)", "AgentInput", "ZodError"),
    ("listGenerationsForWorld", "admin/generations/generationQueryService.ts", "worldId, filters", "1. 検証 2. listGenerations 3. countAttempts 4. hasConsistencyFlags は consistency_flags が空配列でないか", "{ items, nextCursor }", "AppError(400)"),
    ("getGenerationDetail", "admin/generations/generationQueryService.ts", "eventId", "2章 GET generations/:eventId の手順", "GenerationDetail", "AppError(404)"),
    ("parseJsonColumns", "admin/generations/generationQueryService.ts", "row (GenerationRow)", "1. input_attributes・input_memories・input_post_ids・action_candidates・consistency_flags を JSON.parse 2. 失敗したら原文の文字列のまま返し、logger.warn", "object", "なし"),
    ("searchPosts", "admin/moderation/postQueryService.ts", "worldId, { q?, visibility?, agentId?, postId?, cursor?, limit }", "1. 条件を組み立て 2. escapeLike(q) 3. limit+1 件 4. nextCursor", "{ items, nextCursor }", "AppError(400)"),
    ("escapeLike", "lib/sql.ts", "value (string)", "1. \\ を \\\\ に、% を \\% に、_ を \\_ に 2. ESCAPE '\\' と組で使う", "string", "なし"),
    ("hidePost", "admin/moderation/moderationService.ts", "postId, reason, admin", "2章 hide の手順", "{ postId, visibility }", "AppError(404・409)"),
    ("unhidePost", "admin/moderation/moderationService.ts", "postId, reason, admin", "2章 unhide の手順", "{ postId, visibility }", "AppError(404・409)"),
    ("listHideHistory", "admin/moderation/moderationService.ts", "{ cursor?, limit }", "1. listHideRecords 2. 本文を 40 字に切る", "{ items, nextCursor }", "AppError(400)"),
    ("getDailyMetricsView", "admin/metrics/metricsService.ts", "{ from?, to? }", "1. 既定の期間 2. 検証（from ≦ to、90 日以内） 3. getDailyMetrics 4. computeRates", "MetricsView", "AppError(400)"),
    ("computeRates", "admin/metrics/metricsService.ts", "row (DailyRow)", "1. replyRate・errorRate・actions を計算（分母 0 は null）", "DailyMetricsItem", "なし"),
    ("dateRange", "admin/metrics/metricsService.ts", "from (string), to (string)", "1. from から to まで1日ずつの YYYY-MM-DD の配列", "string[]", "なし"),
    ("listWorldSummaries", "admin/worlds/worldArchiveService.ts", "なし", "2章 GET worlds の手順", "{ items }", "なし"),
    ("getArchivePosts", "admin/worlds/worldArchiveService.ts", "worldId, page", "1. 世界の存在 2. searchPosts(worldId, page)", "{ items, nextCursor }", "AppError(404)"),
    ("getArchiveGenerations", "admin/worlds/worldArchiveService.ts", "worldId, page", "1. 世界の存在 2. listGenerationsForWorld(worldId, page)", "{ items, nextCursor }", "AppError(404)"),
]

TX = [
    ("createAgent・updateAgentProfile", "agents の INSERT・UPDATE、interest_profile の upsert、recordAudit", "検証の失敗、HANDLE_TAKEN、状態の不一致"),
    ("deleteAgent", "memories・agents の DELETE、recordAudit", "状態の不一致"),
    ("stopAgent・resumeAgent", "agents の UPDATE、recordAudit", "状態の不一致"),
    ("hidePost・unhidePost", "posts の UPDATE、hide_records の INSERT、recordAudit", "状態の不一致"),
    ("読み取りの API（9 本）", "トランザクションを開かない（WAL の読み取り）", "該当なし"),
]


def table(h, rows):
    return "\n".join(["| " + " | ".join(h) + " |", "| " + " | ".join([":---"] * len(h)) + " |"] + ["| " + " | ".join(r) + " |" for r in rows])


def main():
    L = ["# NOUS バックエンド詳細設計書：管理 API のデータ操作（admin_data）", "",
         "| 項目 | 内容 |", "|---|---|", "| 文書番号 | DD-NOUS-BE-ADMIN-DATA |", "| 版数 | v1 |", "| 作成日 | 2026-10-21 |",
         "| 作成者 | Mark Zuckerberg（開発担当） |", "| レビュー担当 | Kouhei Tajima（再鑑担当） |",
         "| 入力 | 基本設計書（概要）v3.7 7章、DB 物理設計書 v1.1、BE 詳細設計 admin_auth v1・world v1.1、画面基本設計書 P203・P204・P206〜P209・P211 |",
         "| 関連チケット | NOUS-33 |", "", "## 改訂履歴", "", "| 版数 | 日付 | 変更内容 | 変更者 |", "|---|---|---|---|",
         "| v1 | 2026-10-21 | 初版作成 | Mark Zuckerberg |", "", "---", "",
         "## 1. バックエンド構成・モジュール設計", "",
         "* **対象ドメイン**: 管理画面のデータ操作。エージェントの登録・編集・削除・停止・再開、生成ログの参照、投稿の検索と非表示、利用量と運用指標、世界のアーカイブの参照",
         "* **対象APIエンドポイント**: " + "、".join(f"{a['m']} {a['p']}" for a in APIS) + f"（{len(APIS)} 本）",
         "* **ディレクトリ/ファイル構造**:", "", "```",
         "apps/server/src/admin/", "├── data/routes.ts                       # 16 本のルートの登録", "├── agents/agentService.ts",
         "├── generations/generationQueryService.ts", "├── moderation/", "│   ├── postQueryService.ts", "│   └── moderationService.ts",
         "├── metrics/metricsService.ts", "└── worlds/worldArchiveService.ts", "apps/server/src/lib/sql.ts                # escapeLike",
         "packages/shared/schemas/agent.ts          # AgentInputSchema（画面と共用）", "```", "",
         "* **処理シーケンス図**:", "", "```mermaid", "sequenceDiagram",
         '    participant F as "管理画面"', '    participant MW as "requireAdminSession / requireCsrf"', '    participant R as "routes"',
         '    participant S as "moderationService"', '    participant A as "recordAudit"', '    participant DB as "SQLite"',
         '    F->>MW: "POST /admin/api/posts/:postId/hide { reason }"', '    MW->>R: "next"', '    R->>S: "hidePost(postId, reason, admin)"',
         '    S->>DB: "BEGIN、posts を読む、visibility を hidden、hide_records に INSERT"', '    S->>A: "post.hide を同じトランザクションで記録"',
         '    S->>DB: "COMMIT"', '    R-->>F: "200 { postId, visibility }"', "```", "",
         "## 2. API・インターフェース詳細設計", "",
         "* **外部サービス連携仕様**: 該当なし（この領域は外部と通信しない）", "",
         table(["連携先", "連携方式", "エンドポイント / 接続先", "認証方式", "タイムアウト", "リトライ方針", "エラー時の挙動"], [["該当なし"] * 7]), "",
         "* **API詳細仕様**: 全 API で requireAdminSession を、変更の API で requireCsrf を通す（admin_auth）。成功の本文の形とエラーの形は admin_auth の共通の決まりに従う。", ""]
    for a in APIS:
        L += [f"### {a['m']} {a['p']}", f"* **概要**: {a['s']}", f"* **認証要否**: {a['auth']}", "* **リクエストパラメータ**:", ""]
        L += [table(["種別(Path/Query/Body)", "項目名", "型", "必須", "制約・バリデーション", "説明"], a["params"] or [("なし", "なし", "なし", "なし", "なし", "パラメータはない")]), ""]
        L += ["* **レスポンス（成功時）**:", "```json", a["ok"], "```"]
        if a.get("status201"):
            L.append("（HTTP 201）")
        if a.get("status204"):
            L.append("（HTTP 204、本文なし）")
        L += ["* **レスポンスヘッダー**: なし", "* **ステータスコード**:", "", table(["コード", "条件"], a["codes"]), "", "* **ビジネスロジック・副作用**:"]
        L += [f"  {i}. {s}" for i, s in enumerate(a["logic"], 1)]
        L.append("")
    L += ["## 3. データアクセス（ORM / クエリ）設計", "", "* **主要データアクセスロジック**:", "",
          table(["処理名", "対象物理テーブル", "JOIN / Include", "抽出条件 (Where) / ソート", "N+1対策"], DATA_ACCESS), "",
          "## 4. サーバー側機能・処理ロジック設計（IPO設計）", "", "* **入力・処理・出力（IPO）定義**:", "",
          table(["関数名", "所属モジュール", "引数 (型)", "処理フロー (ステップ単位で具体的に)", "戻り値", "発生しうるエラー"], IPO), "",
          "## 5. バッチ処理・非同期タスク設計", "", "* **ジョブ実行定義**: 該当なし（この領域は要求に応じた処理だけを行う）", "",
          table(["ジョブ名", "実行タイミング", "対象テーブル", "処理概要", "タイムアウト"], [["該当なし"] * 5]), "",
          "## 6. 例外処理・セキュリティ設計", "", "* **エラーハンドリング**:", "",
          table(["例外種別", "対応方法", "ログ出力", "クライアント応答"], [
              ("AppError（404・409）", "状態を変えずに返す", "info", "コードと日本語のメッセージ（画面の様式②）"),
              ("ZodError", "400 VALIDATION_ERROR", "debug", "fields に項目ごと（様式④）"),
              ("SqliteError の UNIQUE の違反（agents の handle）", "409 HANDLE_TAKEN に変換", "info", "409"),
              ("JSON の列の解析の失敗", "原文の文字列のまま返す", "warn（実行 ID）", "200（その項目だけ文字列）"),
              ("想定外の例外", "500 INTERNAL_ERROR（admin_auth の errorHandler）", "error（スタック付き）", "固定のメッセージ")]), "",
          "* **トランザクション制御**:", "", table(["処理名", "トランザクション範囲", "ロールバック条件"], TX), "",
          "* **セキュリティの補足**:",
          "  - 投稿の本文・生成の入力と出力は、そのまま JSON で返す。管理画面でテキストとして描画する（NFR-S-011）",
          "  - 部分一致の検索は LIKE の特殊文字をエスケープし、パラメータで渡す（SQL を文字列で組み立てない）",
          "  - 変更の API（7 本）は、変更と同じトランザクションで recordAudit を呼ぶ（NFR-S-008）", ""]
    open(OUT, "w", encoding="utf-8").write("\n".join(L))
    print("apis", len(APIS), "ipo", len(IPO))


if __name__ == "__main__":
    main()
