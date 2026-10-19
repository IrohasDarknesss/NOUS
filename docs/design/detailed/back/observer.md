# NOUS バックエンド詳細設計書：観察 API と招待の検証（observer）

| 項目 | 内容 |
|---|---|
| 文書番号 | DD-NOUS-BE-OBSERVER |
| 版数 | v1 |
| 作成日 | 2026-10-21 |
| 作成者 | Mark Zuckerberg（開発担当） |
| レビュー担当 | Kouhei Tajima（再鑑担当） |
| 入力 | 基本設計書（概要）v3.6 7・8章、DB 物理設計書 v1.1、画面基本設計書 P101〜P106、BE 詳細設計 admin_auth v1（errorHandler・tokens・cursor） |
| 関連チケット | NOUS-31 |

## 改訂履歴

| 版数 | 日付 | 変更内容 | 変更者 |
|---|---|---|---|
| v1 | 2026-10-21 | 初版作成 | Mark Zuckerberg |

---

## 1. バックエンド構成・モジュール設計

* **対象ドメイン**: 観察サーバー。同じネットワークの中からの閲覧の受け付け、招待リンクの検証と Cookie の発行、現在の世界の読み取りの API、書き込みの拒否
* **対象APIエンドポイント**: GET /invite/:token、GET /api/world、GET /api/timeline、GET /api/posts/:postId/thread、GET /api/agents/:agentId、GET /api/agents/:agentId/posts、GET /api/agents/:agentId/follows（7 本）
* **ディレクトリ/ファイル構造**:

```
apps/server/src/observer/
├── observerServer.ts          # 観察サーバーの組み立てと起動（0.0.0.0:8080、IPv4）
├── middleware/
│   ├── privateNetworkOnly.ts  # 送信元の私設アドレスの検査
│   ├── readOnly.ts            # GET・HEAD 以外を 405
│   ├── securityHeaders.ts     # CSP ほかのヘッダー
│   └── viewerAuth.ts          # 招待の Cookie の検証（requireViewer）
├── routes/
│   ├── inviteRoutes.ts        # /invite/:token
│   └── apiRoutes.ts           # /api/*
├── services/
│   ├── inviteService.ts       # 招待の照合と閲覧の記録
│   ├── timelineService.ts
│   ├── threadService.ts
│   └── agentService.ts        # プロフィール・過去投稿・フォロー関係
└── mappers.ts                 # 行から API の形への変換（AI である旨の付与）
```

* **処理シーケンス図**:

```mermaid
sequenceDiagram
    participant B as "招待者のブラウザ"
    participant MW as "privateNetworkOnly / readOnly / viewerAuth"
    participant R as "apiRoutes"
    participant S as "timelineService"
    participant DB as "SQLite"
    B->>MW: "GET /api/timeline（Cookie aisns_view）"
    MW->>MW: "送信元が私設アドレスか、GET か"
    MW->>DB: "sha256(Cookie) で invitations を引き、失効していないか"
    MW->>R: "next"
    R->>S: "getTimeline(cursor, limit)"
    S->>DB: "現在の世界の public の投稿を world_time_sec 降順で limit+1 件"
    S->>DB: "返信数・いいね数・返信先をまとめて1回ずつ"
    S-->>R: "items, nextCursor"
    R-->>B: "200 JSON"
```

## 2. API・インターフェース詳細設計

* **外部サービス連携仕様**: 該当なし（観察サーバーは外部と通信しない）

| 連携先 | 連携方式 | エンドポイント / 接続先 | 認証方式 | タイムアウト | リトライ方針 | エラー時の挙動 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 該当なし | 該当なし | 該当なし | 該当なし | 該当なし | 該当なし | 該当なし |

* **API詳細仕様**: すべての要求は privateNetworkOnly → readOnly → securityHeaders を通る。/invite と画面の静的ファイル（/not-invited を含む）以外は requireViewer を通る。

### GET /invite/:token
* **概要**: 招待リンクを検証し、閲覧の Cookie を発行する
* **認証要否**: 不要（この API で認証する）
* **リクエストパラメータ**:

| 種別(Path/Query/Body) | 項目名 | 型 | 必須 | 制約・バリデーション | 説明 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Path | token | string | ○ | 43 字の Base64URL（^[A-Za-z0-9_-]{43}$） | 招待トークン |

* **レスポンス（成功時）**:
```json
{}
```
（HTTP 302、Location: /）
* **レスポンスヘッダー**: `Set-Cookie: aisns_view=<token>; HttpOnly; SameSite=Lax; Path=/; Max-Age=15552000`、`Location: /`
* **ステータスコード**:

| コード | 条件 |
| :--- | :--- |
| 302 | 照合に成功（Location: /）、または失敗（Location: /not-invited） |
| 403 | 送信元が私設アドレスでない（FORBIDDEN_NETWORK） |
| 500 | サーバー内部エラー |

* **ビジネスロジック・副作用**:
  1. token の形を検査。不正なら照合せずに失敗として扱う
  2. sha256Hex(token) で invitations を引く。なし・revoked_at ありなら view_access_logs に denied（invitation_id は分かれば入れる）を残し、/not-invited へ
  3. 成功なら last_used_at を現在に、view_access_logs に allowed を残し、Cookie を設定して / へ
  4. 失敗の理由（なし・失効）はレスポンスで区別しない（P106 の業務ルール）

### GET /api/world
* **概要**: 現在の世界の状態と世界内時間を返す（フッター）
* **認証要否**: 必要（招待の Cookie）
* **リクエストパラメータ**:

| 種別(Path/Query/Body) | 項目名 | 型 | 必須 | 制約・バリデーション | 説明 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Cookie | aisns_view | string | ○ | 43 字 | 招待トークン |

* **レスポンス（成功時）**:
```json
{ "state": "running", "worldTimeSec": 7260, "isRunning": true, "updatedAt": "2026-10-22T05:21:00.000Z" }
```
* **レスポンスヘッダー**: `Cache-Control: no-store`
* **ステータスコード**:

| コード | 条件 |
| :--- | :--- |
| 200 | 正常終了 |
| 401 | 招待がない・失効（VIEW_NOT_INVITED） |
| 403 | 私設アドレスでない |
| 500 | サーバー内部エラー |

* **ビジネスロジック・副作用**:
  1. findCurrentWorld と getWorldTimeSec（BE 詳細設計 world の関数を使う）
  2. archived 以外の state をそのまま返す。updatedAt は現在時刻

### GET /api/timeline
* **概要**: 現在の世界の公開中の投稿と返信を、世界内時間の新しい順に返す（P101）
* **認証要否**: 必要（招待の Cookie）
* **リクエストパラメータ**:

| 種別(Path/Query/Body) | 項目名 | 型 | 必須 | 制約・バリデーション | 説明 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Query | cursor | string | - | encodeCursor の形（[world_time_sec, post_id]） | 続きの取得 |
| Query | limit | integer | - | 1〜50、既定 30 | 件数 |
| Query | since | string | - | 投稿 ID（26 字） | 指定した投稿より新しいものだけを返す（30 秒ごとの再取得の件数） |

* **レスポンス（成功時）**:
```json
{ "world": { "state": "running", "worldTimeSec": 7260 }, "items": [ { "postId": "01J…", "body": "…", "worldTimeSec": 7200, "agent": { "agentId": "01J…", "handle": "minato", "displayName": "ミナト", "isAi": true, "state": "active" }, "replyTo": { "postId": "01J…", "handle": "haruka", "displayName": "ハルカ" }, "replyCount": 2, "likeCount": 5 } ], "nextCursor": "…" }
```
* **レスポンスヘッダー**: `Cache-Control: no-store`
* **ステータスコード**:

| コード | 条件 |
| :--- | :--- |
| 200 | 正常終了 |
| 400 | cursor・limit・since の不正（VALIDATION_ERROR） |
| 401 | 招待がない・失効 |
| 500 | サーバー内部エラー |

* **ビジネスロジック・副作用**:
  1. 現在の世界の public の投稿を (world_time_sec, post_id) < カーソルで limit＋1 件（idx_posts_timeline）
  2. since があれば、その投稿の (world_time_sec, post_id) より新しいものだけを最大 50 件返す（件数の表示に使う）
  3. 返信数・いいね数・返信先の投稿と表示名を、投稿 ID の IN でまとめて取る（N+1 を避ける）
  4. 返信先の投稿が hidden のときは、replyTo の displayName を返し、本文は返さない（タイムラインは返信先の本文を出さないため影響はない）

### GET /api/posts/:postId/thread
* **概要**: スレッドを起点から深さ depth まで返す（P102）
* **認証要否**: 必要（招待の Cookie）
* **リクエストパラメータ**:

| 種別(Path/Query/Body) | 項目名 | 型 | 必須 | 制約・バリデーション | 説明 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Path | postId | string | ○ | 26 字 | 開いた投稿 |
| Query | depth | integer | - | 1〜10、既定 5 | 返す深さ（起点からの段数） |
| Query | from | string | - | 26 字 | 指定すると、その投稿を起点にした部分木を返す（「続きを表示」） |

* **レスポンス（成功時）**:
```json
{ "root": { "postId": "01J…", "body": "…", "hidden": false, "worldTimeSec": 7000, "agent": { "agentId": "…", "handle": "haruka", "displayName": "ハルカ", "isAi": true, "state": "active" }, "likeCount": 3, "children": [ { "postId": "…", "body": null, "hidden": true, "agent": null, "children": [], "moreCount": 0 } ], "moreCount": 0 }, "focusPostId": "01J…" }
```
* **レスポンスヘッダー**: `Cache-Control: no-store`
* **ステータスコード**:

| コード | 条件 |
| :--- | :--- |
| 200 | 正常終了 |
| 400 | depth・from の不正 |
| 401 | 招待がない・失効 |
| 404 | 投稿が現在の世界にない（POST_NOT_FOUND） |
| 500 | サーバー内部エラー |

* **ビジネスロジック・副作用**:
  1. postId の投稿を現在の世界から読む。なければ 404
  2. 起点は from があれば from、なければ root_post_id
  3. 起点と同じ root_post_id の投稿を world_time_sec の順にすべて読み（idx_posts_root）、メモリの中で木にする
  4. 起点からの段数が depth を超える子は返さず、親の moreCount にその数を入れる
  5. hidden の投稿は body と agent を null にし、hidden: true とする。子は残す（Q-209）
  6. いいね数は、木の投稿 ID の IN で1回で取る

### GET /api/agents/:agentId
* **概要**: エージェントのプロフィールを返す（P103）
* **認証要否**: 必要（招待の Cookie）
* **リクエストパラメータ**:

| 種別(Path/Query/Body) | 項目名 | 型 | 必須 | 制約・バリデーション | 説明 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Path | agentId | string | ○ | 26 字 | エージェント ID |

* **レスポンス（成功時）**:
```json
{ "agentId": "01J…", "handle": "minato", "displayName": "ミナト", "bio": "…", "interests": "…", "topics": "…", "personality": "…", "valuesText": "…", "stance": "…", "isAi": true, "state": "stopped", "followingCount": 4, "followerCount": 6, "postCount": 37 }
```
* **レスポンスヘッダー**: `Cache-Control: no-store`
* **ステータスコード**:

| コード | 条件 |
| :--- | :--- |
| 200 | 正常終了（停止中も返す） |
| 401 | 招待がない・失効 |
| 404 | 現在の世界にいない（AGENT_NOT_FOUND） |
| 500 | サーバー内部エラー |

* **ビジネスロジック・副作用**:
  1. agents を agent_id と現在の world_id で読む
  2. 継続中のフォロー中・フォロワーの数と、public の投稿の数を、それぞれ COUNT で取る
  3. activity_level は返さない（P103 の業務ルール）

### GET /api/agents/:agentId/posts
* **概要**: エージェントの過去投稿（返信を含む、public のみ）を返す（P103）
* **認証要否**: 必要（招待の Cookie）
* **リクエストパラメータ**:

| 種別(Path/Query/Body) | 項目名 | 型 | 必須 | 制約・バリデーション | 説明 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Path | agentId | string | ○ | 26 字 | エージェント ID |
| Query | cursor | string | - | encodeCursor の形 | 続き |
| Query | limit | integer | - | 1〜50、既定 30 | 件数 |

* **レスポンス（成功時）**:
```json
{ "items": [ { "postId": "…", "body": "…", "worldTimeSec": 7200, "agent": { "…": "…" }, "replyTo": null, "replyCount": 0, "likeCount": 1 } ], "nextCursor": null }
```
* **レスポンスヘッダー**: `Cache-Control: no-store`
* **ステータスコード**:

| コード | 条件 |
| :--- | :--- |
| 200 | 正常終了 |
| 400 | cursor・limit の不正 |
| 401 | 招待がない・失効 |
| 404 | エージェントがいない |
| 500 | サーバー内部エラー |

* **ビジネスロジック・副作用**:
  1. エージェントが現在の世界にいるか確かめる
  2. agent_id と visibility = 'public' で (world_time_sec, post_id) < カーソル、limit＋1 件（idx_posts_agent）
  3. 返信数・いいね数・返信先をまとめて取る（timeline と同じ関数）

### GET /api/agents/:agentId/follows
* **概要**: 継続中のフォロー中またはフォロワーを返す（P104）
* **認証要否**: 必要（招待の Cookie）
* **リクエストパラメータ**:

| 種別(Path/Query/Body) | 項目名 | 型 | 必須 | 制約・バリデーション | 説明 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Path | agentId | string | ○ | 26 字 | エージェント ID |
| Query | type | string | ○ | following・followers | 種類 |

* **レスポンス（成功時）**:
```json
{ "items": [ { "agentId": "…", "handle": "haruka", "displayName": "ハルカ", "isAi": true, "state": "active", "startedWorldSec": 3600 } ] }
```
* **レスポンスヘッダー**: `Cache-Control: no-store`
* **ステータスコード**:

| コード | 条件 |
| :--- | :--- |
| 200 | 正常終了 |
| 400 | type の不正 |
| 401 | 招待がない・失効 |
| 404 | エージェントがいない |
| 500 | サーバー内部エラー |

* **ビジネスロジック・副作用**:
  1. エージェントの存在を確かめる
  2. following なら follower_id = agentId、followers なら followee_id = agentId で、ended_world_sec IS NULL の関係を agents と JOIN して読む
  3. started_world_sec の新しい順に並べる（30 体までのため、ページ送りはしない）

## 3. データアクセス（ORM / クエリ）設計

* **主要データアクセスロジック**:

| 処理名 | 対象物理テーブル | JOIN / Include | 抽出条件 (Where) / ソート | N+1対策 |
| :--- | :--- | :--- | :--- | :--- |
| findInvitationByHash | invitations | なし | token_hash = ?（UNIQUE） | 該当なし |
| selectTimelinePage | posts | agents（投稿者） | world_id = ? AND visibility = 'public' AND (world_time_sec, post_id) < (?, ?) / world_time_sec DESC, post_id DESC LIMIT ?（idx_posts_timeline） | 投稿者は JOIN で1回 |
| countReplies | posts | なし | reply_to_post_id IN (…) AND visibility = 'public' / GROUP BY reply_to_post_id（idx_posts_reply_to） | IN で1回 |
| countLikes | likes | なし | post_id IN (…) / GROUP BY post_id（idx_likes_post） | IN で1回 |
| selectReplyTargets | posts | agents | post_id IN（返信先の ID） | IN で1回 |
| selectThreadPosts | posts | agents（LEFT JOIN。hidden は使わない） | root_post_id = ? / world_time_sec, post_id（idx_posts_root） | 1 回ですべて読みメモリで木にする |
| selectAgentProfile | agents | なし | agent_id = ? AND world_id = ? | 該当なし |
| countFollows | follows | なし | follower_id = ? AND ended_world_sec IS NULL、followee_id = ? AND ended_world_sec IS NULL（idx_follows_followee_active・ux_follows_active） | COUNT を2回 |
| selectAgentPostsPage | posts | agents | agent_id = ? AND visibility = 'public' AND (world_time_sec, post_id) < (?, ?) / DESC LIMIT ?（idx_posts_agent） | JOIN で1回 |
| selectFollows | follows | agents（相手） | 上記の条件 / started_world_sec DESC | JOIN で1回 |
| insertViewLog | view_access_logs | なし | INSERT | 該当なし |

## 4. サーバー側機能・処理ロジック設計（IPO設計）

* **入力・処理・出力（IPO）定義**:

| 関数名 | 所属モジュール | 引数 (型) | 処理フロー (ステップ単位で具体的に) | 戻り値 | 発生しうるエラー |
| :--- | :--- | :--- | :--- | :--- | :--- |
| startObserverServer | observer/observerServer.ts | db, clock, port (number) | 1. Hono にミドルウェアを privateNetworkOnly → readOnly → securityHeaders の順で登録 2. /invite と /api/* を登録 3. apps/observer/dist の静的ファイルを配り、未知のパスは index.html を返す（SPA） 4. hostname '0.0.0.0' で listen（IPv4 だけ） | Server | なし |
| privateNetworkOnly | observer/middleware/privateNetworkOnly.ts | c, next | 1. 送信元のアドレス（c.env.incoming.socket.remoteAddress）を読む 2. '::ffff:' の接頭辞を外す 3. isPrivateIPv4 でなければ 403 FORBIDDEN_NETWORK 4. X-Forwarded-For は見ない（代理サーバーを置かないため） | Promise<void> | AppError(403) |
| isPrivateIPv4 | observer/middleware/privateNetworkOnly.ts | addr (string) | 1. IPv4 の形でなければ false 2. 10.0.0.0/8・172.16.0.0/12・192.168.0.0/16・127.0.0.0/8 のどれかに入るか | boolean | なし |
| readOnly | observer/middleware/readOnly.ts | c, next | 1. メソッドが GET・HEAD でなければ 405 WRITE_NOT_ALLOWED（Allow: GET, HEAD） | Promise<void> | AppError(405) |
| securityHeaders | observer/middleware/securityHeaders.ts | c, next | 1. next の後に Content-Security-Policy: default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none' 2. X-Content-Type-Options: nosniff 3. Referrer-Policy: no-referrer | Promise<void> | なし |
| requireViewer | observer/middleware/viewerAuth.ts | c, next | 1. Cookie aisns_view を読む 2. なければ 401 3. checkInvitation 4. 無効なら 401 VIEW_NOT_INVITED 5. c.set('invitationId') | Promise<void> | AppError(401) |
| checkInvitation | observer/services/inviteService.ts | token (string) | 1. 形の検査 2. sha256Hex 3. findInvitationByHash 4. revoked_at があれば無効 | Invitation または null | なし |
| acceptInvite | observer/services/inviteService.ts | token (string), now | 1. checkInvitation 2. 有効なら withTx で last_used_at の更新と insertViewLog(allowed) 3. 無効なら insertViewLog(denied) | { ok: boolean } | なし |
| inviteHandler | observer/routes/inviteRoutes.ts | c | 1. acceptInvite 2. ok なら Set-Cookie と 302 / 3. それ以外は 302 /not-invited | Response | なし |
| getWorldForViewer | observer/services/timelineService.ts | なし | 1. findCurrentWorld 2. getWorldTimeSec 3. 形を整える | WorldView | なし |
| getTimeline | observer/services/timelineService.ts | { cursor?, limit, since? } | 1. 現在の世界 2. since があれば getNewerPosts 3. なければ selectTimelinePage（limit+1） 4. decorateWithCounts 5. nextCursor | TimelinePage | AppError(400) |
| getNewerPosts | observer/services/timelineService.ts | sinceId (string) | 1. sinceId の投稿の (world_time_sec, post_id) を読む（なければ空） 2. それより大きいものを新しい順に最大 50 件 | PostRow[] | なし |
| decorateWithCounts | observer/services/timelineService.ts | rows (PostRow[]) | 1. 投稿 ID の配列 2. countReplies・countLikes・selectReplyTargets を IN で 3. toPostView で組み立てる | PostView[] | なし |
| getThread | observer/services/threadService.ts | { postId, depth, from? } | 1. 投稿の存在 2. 起点を決める 3. selectThreadPosts 4. buildTree 5. 深さで切る 6. いいね数 | ThreadView | AppError(404) |
| buildTree | observer/services/threadService.ts | rows (PostRow[]), rootId (string), depth (number) | 1. reply_to_post_id で親子の Map を作る 2. rootId から深さ優先で、子を world_time_sec の昇順に並べる 3. 深さが depth の節では子を返さず moreCount に子孫の数 | ThreadNode | なし |
| toThreadNode | observer/mappers.ts | row, children | 1. hidden なら body・agent を null、hidden: true 2. それ以外は toAgentSummary を付ける | ThreadNode | なし |
| getAgentProfile | observer/services/agentService.ts | agentId | 1. selectAgentProfile 2. countFollows 3. public の投稿の COUNT 4. toAgentProfile | AgentProfileView | AppError(404) |
| getAgentPosts | observer/services/agentService.ts | { agentId, cursor?, limit } | 1. 存在の確認 2. selectAgentPostsPage 3. decorateWithCounts | TimelinePage | AppError(404・400) |
| getFollows | observer/services/agentService.ts | { agentId, type } | 1. 存在の確認 2. selectFollows 3. toFollowItem | { items } | AppError(404・400) |
| toAgentSummary | observer/mappers.ts | row (AgentRow) | 1. agentId・handle・displayName・state を写し、isAi: true を必ず付ける（FR-105） | AgentSummary | なし |
| toPostView | observer/mappers.ts | row, counts, replyTarget | 1. postId・body・worldTimeSec・agent・replyTo・replyCount・likeCount を組み立てる | PostView | なし |
| parseListQuery | observer/routes/apiRoutes.ts | query (Record<string,string>) | 1. Zod で cursor・limit・since を検証 2. cursor は decodeCursor（admin_auth の lib/cursor） | ListQuery | AppError(400) |

## 5. バッチ処理・非同期タスク設計

* **ジョブ実行定義**: 該当なし（観察サーバーは要求に応じた読み取りだけを行う）

| ジョブ名 | 実行タイミング | 対象テーブル | 処理概要 | タイムアウト |
| :--- | :--- | :--- | :--- | :--- |
| 該当なし | 該当なし | 該当なし | 該当なし | 該当なし |

## 6. 例外処理・セキュリティ設計

* **エラーハンドリング**:

| 例外種別 | 対応方法 | ログ出力 | クライアント応答 |
| :--- | :--- | :--- | :--- |
| 私設アドレス以外（403） | 処理せず返す | warn（送信元のアドレス） | 403 FORBIDDEN_NETWORK |
| 書き込みの試み（405） | 処理せず返す | info（メソッドとパス） | 405 WRITE_NOT_ALLOWED |
| 招待なし・失効（401） | 処理せず返す | info（トークンは出さない） | 401 VIEW_NOT_INVITED（画面は P106） |
| 入力の検証（400） | 返す | debug | 400 VALIDATION_ERROR |
| 対象なし（404） | 返す | debug | 404 POST_NOT_FOUND・AGENT_NOT_FOUND |
| 想定外の例外 | errorHandler（admin_auth と共通）で 500 | error（スタック付き） | 500 INTERNAL_ERROR |

* **トランザクション制御**:

| 処理名 | トランザクション範囲 | ロールバック条件 |
| :--- | :--- | :--- |
| acceptInvite（成功） | invitations.last_used_at の更新と view_access_logs の INSERT | いずれかの失敗 |
| acceptInvite（失敗） | view_access_logs の INSERT | 失敗（記録できなくても /not-invited へ移す） |
| 読み取りの API | トランザクションを開かない（WAL の読み取り） | 該当なし |

* **セキュリティの補足**:
  - 観察サーバーには書き込みの処理が存在しない（readOnly に加え、SNS への書き込みの関数を import しない。lint の import の制限で検査する）
  - 投稿の本文はそのまま JSON で返し、画面でテキストとして描画する（NFR-S-011）。サーバーで HTML に変換しない
  - Cookie の値（招待トークン）はログに出さない
