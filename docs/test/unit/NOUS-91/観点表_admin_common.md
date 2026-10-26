# 単体テスト観点表：管理サーバーの共通（adminServer・context・middleware）

| 項目 | 内容 |
|---|---|
| 関連チケット | NOUS-91 |
| 作成者 | Jane Doe（テスト担当） |
| 作成日 | 2026-10-26 |
| 対象 | apps/server/src/admin/adminServer.ts, apps/server/src/admin/context.ts, apps/server/src/admin/middleware/csrf.ts, apps/server/src/admin/middleware/errorHandler.ts, apps/server/src/admin/middleware/sessionAuth.ts |
| 言語 / フレームワーク | TypeScript / Vitest 2.1.9（environment: node）、Hono 4.6 |
| テストファイル | apps/server/src/admin/adminServer.test.ts（実装時、NOUS-52）, apps/server/src/admin/middleware/csrf.test.ts（実装時、NOUS-52）, apps/server/src/admin/middleware/errorHandler.test.ts（実装時、NOUS-52）, apps/server/src/admin/middleware/sessionAuth.test.ts（実装時、NOUS-52）, apps/server/src/admin/adminServer.ut.test.ts（単体テストで追加）, apps/server/src/admin/middleware/csrf.ut.test.ts（単体テストで追加）, apps/server/src/admin/middleware/errorHandler.ut.test.ts（単体テストで追加）, apps/server/src/admin/middleware/sessionAuth.ut.test.ts（単体テストで追加） |
| 外部依存 | SQLite（一時 DB）, Clock（FakeClock）, Logger（captureLogger）, @hono/node-server（startAdminServer の listen。ポート 0）, node:fs（画面の静的ファイル） |
| 入力にした設計書 | BE 詳細設計 admin_auth 1章・2章「共通の決まり」・3章 findActiveSession・deleteExpiredSessions・4章 startAdminServer・assertLocalBind・requireAdminSession・requireCsrf・errorHandler・5章・6章, 基本設計書 概要 4章「エラーの返し方」・8章、NFR-S-007 |

このファイルは `docs/test/unit/_build/build_matrix.py` で JSON から作る。直すときは JSON を直して作り直す。

## 1. 分岐の一覧

| ID | 条件 | 場所 |
|---|---|---|
| B1 | host !== "127.0.0.1" | adminServer.ts:45 |
| B2 | 公開の道（PUBLIC_ROUTES のメソッドと道の組。末尾の / は除く） | adminServer.ts:50-51・55 |
| B3 | options.staticDir が未指定（既定の apps/admin/dist） | adminServer.ts:85 |
| B4 | staticDir があり、ディレクトリが存在する | adminServer.ts:86 |
| B5 | 道が /admin/api で始まる（index.html を返さない） | adminServer.ts:92 |
| B6 | options.host が指定されている | adminServer.ts:119 |
| B7 | deleted > 0（削除の件数をログに出す） | adminServer.ts:126 |
| B8 | 削除で例外（catch） | adminServer.ts:127 |
| B9 | GET・HEAD（CSRF を確かめない） | middleware/csrf.ts:16 |
| B10 | !header \|\| !admin \|\| !safeEqual | middleware/csrf.ts:22 |
| B11 | err instanceof AppError | middleware/errorHandler.ts:38 |
| B12 | err instanceof ZodError | middleware/errorHandler.ts:42 |
| B13 | SqliteError が見つかった | middleware/errorHandler.ts:47 |
| B14 | UNIQUE・PRIMARYKEY の違反 | middleware/errorHandler.ts:23・49 |
| B15 | name が SqliteError（偽なら cause をたどる） | middleware/errorHandler.ts:12-17 |
| B16 | code が文字列でない（SQLITE_ERROR にする） | middleware/errorHandler.ts:15 |
| B17 | issue.path が空（_ にする） | middleware/errorHandler.ts:30 |
| B18 | 同じ項目にすでに文言がある（??= で残す） | middleware/errorHandler.ts:31 |
| B19 | !cookie | middleware/sessionAuth.ts:73 |
| B20 | !session（無効・期限切れ） | middleware/sessionAuth.ts:79 |

## 2. ケースの一覧（41 件。うち新しく足したもの 22 件）

| ID | 対象 | 分類 | 技法 | 観点 | 前提 | 入力 | 期待結果 | 分岐 | モック | 既存テストとの対応 | バグの疑い | テスト名 | 備考 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| TC-NOUS52_DEV-17 | assertLocalBind / startAdminServer | 異常系 | 開発者テスト | 127.0.0.1 以外のアドレスでは起動しない | なし | テストコードのとおり | 127.0.0.1 以外のアドレスでは起動しない | B1-T, B1-F | なし | 実装時のテスト（NOUS-52） |  | TC-NOUS52_DEV-17 127.0.0.1 以外のアドレスでは起動しない |  |
| TC-NOUS52_DEV-18 | createAdminApp（adminApiGuard） | 異常系 | 開発者テスト | /admin/api 以下はセッションがなければ 401 | なし | テストコードのとおり | /admin/api 以下はセッションがなければ 401 | B2-F, B19-T | 一時 DB（createTestDb）、FakeClock（TEST_NOW = 2026-10-20T00:00:00.000Z） | 実装時のテスト（NOUS-52） |  | TC-NOUS52_DEV-18 /admin/api 以下はセッションがなければ 401 |  |
| TC-NOUS52_DEV-19 | createAdminApp（adminApiGuard） | 異常系 | 開発者テスト | 変更の要求はセッションに加えて CSRF を確かめる | なし | テストコードのとおり | 変更の要求はセッションに加えて CSRF を確かめる | B2-F, B9-F, B10-T, B10-F | 一時 DB（createTestDb）、FakeClock（TEST_NOW = 2026-10-20T00:00:00.000Z） | 実装時のテスト（NOUS-52） |  | TC-NOUS52_DEV-19 変更の要求はセッションに加えて CSRF を確かめる |  |
| TC-NOUS52_DEV-20 | createAdminApp（PUBLIC_ROUTES） | 正常系 | 開発者テスト | login と GET /session は requireAdminSession・requireCsrf を通さない | なし | テストコードのとおり | login と GET /session は requireAdminSession・requireCsrf を通さない | B2-T | 一時 DB（createTestDb）、FakeClock（TEST_NOW = 2026-10-20T00:00:00.000Z） | 実装時のテスト（NOUS-52） |  | TC-NOUS52_DEV-20 login と GET /session は requireAdminSession・requireCsrf を通さない |  |
| TC-NOUS52_DEV-21 | startAdminServer（期限切れの削除） | 正常系 | 開発者テスト | 起動時に期限切れのセッションを消し、60 分ごとに消し直す | なし | テストコードのとおり | 起動時に期限切れのセッションを消し、60 分ごとに消し直す | B6-T, B7-T, B8-F | 一時 DB（createTestDb）、FakeClock（TEST_NOW = 2026-10-20T00:00:00.000Z） | 実装時のテスト（NOUS-52） |  | TC-NOUS52_DEV-21 起動時に期限切れのセッションを消し、60 分ごとに消し直す |  |
| TC-NOUS52_DEV-22 | createAdminApp（静的ファイル） | 正常系 | 開発者テスト | 画面の静的ファイルを配り、画面の URL では index.html を返す | なし | テストコードのとおり | 画面の静的ファイルを配り、画面の URL では index.html を返す | B3-F, B4-T, B5-T, B5-F | 一時ディレクトリ（mkdtemp）、一時 DB（createTestDb）、FakeClock（TEST_NOW = 2026-10-20T00:00:00.000Z） | 実装時のテスト（NOUS-52） |  | TC-NOUS52_DEV-22 画面の静的ファイルを配り、画面の URL では index.html を返す |  |
| TC-NOUS52_DEV-06 | requireCsrf | 正常系 | 開発者テスト | GET は X-CSRF-Token なしで通る | なし | テストコードのとおり | GET は X-CSRF-Token なしで通る | B9-T | なし | 実装時のテスト（NOUS-52） |  | TC-NOUS52_DEV-06 GET は X-CSRF-Token なしで通る |  |
| TC-NOUS52_DEV-07 | requireCsrf | 正常系 | 開発者テスト | POST・PUT・DELETE は一致するトークンで通る | なし | テストコードのとおり | POST・PUT・DELETE は一致するトークンで通る | B9-F, B10-F | なし | 実装時のテスト（NOUS-52） |  | TC-NOUS52_DEV-07 POST・PUT・DELETE は一致するトークンで通る |  |
| TC-NOUS52_DEV-08 | requireCsrf | 異常系 | 開発者テスト | トークンがない・違うなら 403 CSRF_INVALID | なし | テストコードのとおり | トークンがない・違うなら 403 CSRF_INVALID | B10-T | なし | 実装時のテスト（NOUS-52） |  | TC-NOUS52_DEV-08 トークンがない・違うなら 403 CSRF_INVALID |  |
| TC-NOUS52_DEV-09 | errorHandler | 正常系 | 開発者テスト | AppError を status と code・message・fields の本文で返す | なし | テストコードのとおり | AppError を status と code・message・fields の本文で返す | B11-T | なし | 実装時のテスト（NOUS-52） |  | TC-NOUS52_DEV-09 AppError を status と code・message・fields の本文で返す |  |
| TC-NOUS52_DEV-10 | errorHandler / zodFields | 異常系 | 開発者テスト | ZodError を 400 VALIDATION_ERROR と項目ごとのメッセージにする | なし | テストコードのとおり | ZodError を 400 VALIDATION_ERROR と項目ごとのメッセージにする | B11-F, B12-T, B17-F, B18-F | なし | 実装時のテスト（NOUS-52） |  | TC-NOUS52_DEV-10 ZodError を 400 VALIDATION_ERROR と項目ごとのメッセージにする |  |
| TC-NOUS52_DEV-11 | errorHandler | 異常系 | 開発者テスト | 想定外の例外は 500 INTERNAL_ERROR の固定の文言で返し、スタックはログだけに出す | なし | テストコードのとおり | 想定外の例外は 500 INTERNAL_ERROR の固定の文言で返し、スタックはログだけに出す | B12-F, B13-F | なし | 実装時のテスト（NOUS-52） |  | TC-NOUS52_DEV-11 想定外の例外は 500 INTERNAL_ERROR の固定の文言で返し、スタックはログだけに出す |  |
| TC-NOUS52_DEV-12 | toAppError | 異常系 | 開発者テスト | SqliteError の UNIQUE の違反は SQL の文を出さずに 409 CONFLICT にする | なし | テストコードのとおり | SqliteError の UNIQUE の違反は SQL の文を出さずに 409 CONFLICT にする | B13-T, B14-T, B15-T | 一時 DB（createTestDb） | 実装時のテスト（NOUS-52） |  | TC-NOUS52_DEV-12 SqliteError の UNIQUE の違反は SQL の文を出さずに 409 CONFLICT にする |  |
| TC-NOUS52_DEV-23 | toAppError | 異常系 | 開発者テスト | UNIQUE 以外の SqliteError（CHECK の違反）は 500 INTERNAL_ERROR にする | なし | テストコードのとおり | UNIQUE 以外の SqliteError（CHECK の違反）は 500 INTERNAL_ERROR にする | B13-T, B14-F | 一時 DB（createTestDb） | 実装時のテスト（NOUS-52） |  | TC-NOUS52_DEV-23 UNIQUE 以外の SqliteError（CHECK の違反）は 500 INTERNAL_ERROR にする |  |
| TC-NOUS52_DEV-01 | requireAdminSession | 正常系 | 開発者テスト | 有効なセッションの Cookie で通り、c.var.admin に管理者が入る | なし | テストコードのとおり | 有効なセッションの Cookie で通り、c.var.admin に管理者が入る | B19-F, B20-F | 一時 DB（createTestDb）、FakeClock（TEST_NOW = 2026-10-20T00:00:00.000Z） | 実装時のテスト（NOUS-52） |  | TC-NOUS52_DEV-01 有効なセッションの Cookie で通り、c.var.admin に管理者が入る |  |
| TC-NOUS52_DEV-02 | requireAdminSession | 異常系 | 開発者テスト | Cookie がない・知らない値なら 401 ADMIN_UNAUTHORIZED | なし | テストコードのとおり | Cookie がない・知らない値なら 401 ADMIN_UNAUTHORIZED | B19-T, B20-T | 一時 DB（createTestDb）、FakeClock（TEST_NOW = 2026-10-20T00:00:00.000Z） | 実装時のテスト（NOUS-52） |  | TC-NOUS52_DEV-02 Cookie がない・知らない値なら 401 ADMIN_UNAUTHORIZED |  |
| TC-NOUS52_DEV-03 | requireAdminSession（touchSession） | 正常系 | 開発者テスト | 最終操作を更新する | なし | テストコードのとおり | 最終操作を更新する | B20-F | 一時 DB（createTestDb）、FakeClock（TEST_NOW = 2026-10-20T00:00:00.000Z） | 実装時のテスト（NOUS-52） |  | TC-NOUS52_DEV-03 最終操作を更新する |  |
| TC-NOUS52_DEV-04 | findActiveSession | 異常系 | 開発者テスト | 作成から 8 時間・最終操作から 60 分を過ぎたセッションは無効 | なし | テストコードのとおり | 作成から 8 時間・最終操作から 60 分を過ぎたセッションは無効 |  | 一時 DB（createTestDb） | 実装時のテスト（NOUS-52） |  | TC-NOUS52_DEV-04 作成から 8 時間・最終操作から 60 分を過ぎたセッションは無効 |  |
| TC-NOUS52_DEV-05 | deleteExpiredSessions | 正常系 | 開発者テスト | deleteExpiredSessions が失効したものだけを消す | なし | テストコードのとおり | deleteExpiredSessions が失効したものだけを消す |  | 一時 DB（createTestDb）、FakeClock（TEST_NOW = 2026-10-20T00:00:00.000Z） | 実装時のテスト（NOUS-52） |  | TC-NOUS52_DEV-05 deleteExpiredSessions が失効したものだけを消す |  |
| TC-UT_ADM-001 | assertLocalBind | 異常系 | 同値分割 | assertLocalBind は 127.0.0.1 以外を AdminBindError にし、指定のアドレスを文言に入れる | なし | host = localhost、0.0.0.0、::1、127.0.0.2、空文字 | どれも AdminBindError。文言に「（指定: <host>）」 | B1-T | なし | 一部 TC-NOUS52_DEV-17（0.0.0.0 だけ） |  | TC-UT_ADM-001 assertLocalBind は 127.0.0.1 以外を AdminBindError にし、指定のアドレスを文言に入れる |  |
| TC-UT_ADM-002 | startAdminServer | 異常系 | 分岐網羅 | 127.0.0.1 以外を渡すと、期限切れのセッションの削除も定期の削除も始めずに止まる | 作成から 2 時間たったセッション 1 件 | host = 0.0.0.0 | AdminBindError で止まり、セッションは消さず、定期の削除のタイマーも張らない（listen の前に止める） | B1-T, B6-F | 一時 DB（createTestDb）、FakeClock（TEST_NOW = 2026-10-20T00:00:00.000Z） | なし（DEV-17 は assertLocalBind だけ） |  | TC-UT_ADM-002 127.0.0.1 以外を渡すと、期限切れのセッションの削除も定期の削除も始めずに止まる |  |
| TC-UT_ADM-003 | createAdminApp（adminApiGuard） | 異常系 | 同値分割 | 公開の道とメソッドが違えばセッションを求める | Cookie なし | POST /session、GET /login、DELETE /session | どれも 401 ADMIN_UNAUTHORIZED（公開の道はメソッドと道の組で決まる） | B2-F, B19-T | 一時 DB（createTestDb）、FakeClock（TEST_NOW = 2026-10-20T00:00:00.000Z） | 一部 TC-NOUS52_DEV-20（公開の組だけ） |  | TC-UT_ADM-003 公開の道とメソッドが違えばセッションを求める |  |
| TC-UT_ADM-004 | createAdminApp（PUBLIC_ROUTES の HEAD） | 正常系 | 分岐網羅 | HEAD /admin/api/session は CSRF を求めず、有効なセッションなら 200 を返す | 有効なセッション | HEAD /admin/api/session（X-CSRF-Token なし） | 200（CSRF を求めない） | B2-T, B19-F, B20-F | 一時 DB（createTestDb）、FakeClock（TEST_NOW = 2026-10-20T00:00:00.000Z） | なし |  | TC-UT_ADM-004 HEAD /admin/api/session は CSRF を求めず、有効なセッションなら 200 を返す | Hono は HEAD を GET の道で処理するため、GET /session と同じく authRoutes の requireAdminSession で Cookie を確かめる |
| TC-UT_ADM-005 | createAdminApp（静的ファイル） | 異常系 | 分岐網羅 | ログイン中でも、/admin/api 以下の知らない道には index.html を返さない | 画面の置き場所あり、有効なセッション | GET /admin/api/unknown | 404 で、index.html を返さない | B4-T, B5-T | 一時ディレクトリ（mkdtemp）、一時 DB（createTestDb）、FakeClock（TEST_NOW = 2026-10-20T00:00:00.000Z） | 一部 TC-NOUS52_DEV-22（セッションなしの 401 だけ） |  | TC-UT_ADM-005 ログイン中でも、/admin/api 以下の知らない道には index.html を返さない |  |
| TC-UT_ADM-006 | createAdminApp（静的ファイル） | 異常系 | 分岐網羅 | 静的ファイルの置き場所が無ければ画面を配らない | 画面の置き場所のディレクトリがない | GET /agents | 404（画面を配らない） | B3-F, B4-F | 一時ディレクトリ（mkdtemp） | なし |  | TC-UT_ADM-006 静的ファイルの置き場所が無ければ画面を配らない |  |
| TC-UT_ADM-007 | startAdminServer（期限切れの削除） | 正常系 | 分岐網羅 | 起動時の削除が 0 件ならログを出さず、1 件以上なら件数をログに出す | セッションなし → 2 時間後に 1 件 | 起動、FakeClock を 2 時間進める | 起動時は admin_sessions_swept を出さず、削除が 1 件のときだけ info で deleted: 1 を出す | B7-T, B7-F | 一時 DB（createTestDb）、FakeClock（TEST_NOW = 2026-10-20T00:00:00.000Z）、captureLogger | 一部 TC-NOUS52_DEV-21（件数だけで、ログを見ていない） |  | TC-UT_ADM-007 起動時の削除が 0 件ならログを出さず、1 件以上なら件数をログに出す |  |
| TC-UT_ADM-008 | startAdminServer（期限切れの削除） | 異常系 | エラー処理 | 期限切れのセッションの削除に失敗しても、error のログを出して起動を続ける | DB を閉じておく | 起動 | error で admin_sessions_sweep_failed を出し、起動を続けて定期の削除のタイマーを張る | B8-T | 一時 DB（createTestDb）、FakeClock（TEST_NOW = 2026-10-20T00:00:00.000Z）、captureLogger | なし |  | TC-UT_ADM-008 期限切れのセッションの削除に失敗しても、error のログを出して起動を続ける |  |
| TC-UT_ADM-009 | requireCsrf | 異常系 | 分岐網羅 | トークンが合っていても、requireAdminSession を通っていない（c.var.admin がない）なら 403 | c.var.admin を入れない | POST、正しい形の X-CSRF-Token | 403 CSRF_INVALID | B9-F, B10-T | c.var.admin を差し替え | なし |  | TC-UT_ADM-009 トークンが合っていても、requireAdminSession を通っていない（c.var.admin がない）なら 403 |  |
| TC-UT_ADM-010 | requireCsrf | 異常系 | 同値分割 | PATCH も変更の要求として CSRF を確かめる | c.var.admin あり | PATCH（トークンなし／あり） | なし：403、あり：200 | B9-F, B10-T, B10-F | c.var.admin を差し替え | 一部 TC-NOUS52_DEV-07・08（POST・PUT・DELETE だけ） |  | TC-UT_ADM-010 PATCH も変更の要求として CSRF を確かめる |  |
| TC-UT_ADM-011 | requireCsrf | 正常系 | 同値分割 | ヘッダーの名前は大文字小文字を問わない | c.var.admin あり | POST、ヘッダー名 x-csrf-token（小文字） | 200 | B9-F, B10-F | c.var.admin を差し替え | なし |  | TC-UT_ADM-011 ヘッダーの名前は大文字小文字を問わない |  |
| TC-UT_ADM-012 | requireCsrf | 異常系 | 境界値 | トークンの長さ・中身が少しでも違えば 403 | c.var.admin あり | DELETE、1 字短い・最後の 1 字だけ違う・空のトークン | どれも 403 | B10-T | c.var.admin を差し替え | 一部 TC-NOUS52_DEV-08（なし・まったく違う値だけ） |  | TC-UT_ADM-012 トークンの長さ・中身が少しでも違えば 403 |  |
| TC-UT_ADM-013 | toAppError（findSqliteError） | 異常系 | 分岐網羅 | Drizzle などが cause に包んだ SqliteError も UNIQUE の違反として 409 CONFLICT にする | なし | cause に SqliteError（SQLITE_CONSTRAINT_UNIQUE）を持つ Error | 409 CONFLICT | B13-T, B14-T, B15-F, B15-T | SqliteError と同じ name・code の Error | 一部 TC-NOUS52_DEV-12（包まれていない SqliteError だけ） |  | TC-UT_ADM-013 Drizzle などが cause に包んだ SqliteError も UNIQUE の違反として 409 CONFLICT にする |  |
| TC-UT_ADM-014 | toAppError（findSqliteError） | 異常系 | 境界値 | cause をたどるのは 5 段まで | なし | SqliteError を cause で 4 回・5 回包む | 4 回：409 CONFLICT、5 回：500 INTERNAL_ERROR（たどるのは 5 段まで） | B13-T, B13-F, B15-T, B15-F | SqliteError と同じ name・code の Error | なし |  | TC-UT_ADM-014 cause をたどるのは 5 段まで |  |
| TC-UT_ADM-015 | toAppError / isUniqueViolation | 異常系 | 同値分割 | 主キーの違反は 409、外部キーの違反と文字列でない code は 500 にする | なし | code = SQLITE_CONSTRAINT_PRIMARYKEY、SQLITE_CONSTRAINT_FOREIGNKEY、123（数値） | 主キー：409、外部キー：500、数値：code を SQLITE_ERROR としてログに出し 500 | B14-T, B14-F, B16-T, B16-F | SqliteError と同じ name・code の Error、captureLogger | 一部 TC-NOUS52_DEV-12・23（UNIQUE と CHECK だけ） |  | TC-UT_ADM-015 主キーの違反は 409、外部キーの違反と文字列でない code は 500 にする |  |
| TC-UT_ADM-016 | zodFields | 異常系 | 分岐網羅 | zodFields は項目のない問題を _ に、同じ項目の2つ目以降は捨てて最初の文言にする | なし | label が min と regex の両方に違反、項目のない refine の違反 | label は最初の文言「3 字以上」だけ、項目のない問題は _ に入る | B17-T, B17-F, B18-T, B18-F | なし | 一部 TC-NOUS52_DEV-10（項目ごとに 1 つずつだけ） |  | TC-UT_ADM-016 zodFields は項目のない問題を _ に、同じ項目の2つ目以降は捨てて最初の文言にする |  |
| TC-UT_ADM-017 | toAppError | 異常系 | 同値分割 | toAppError は Error でない値（文字列）も 500 INTERNAL_ERROR の固定の文言にする | なし | 文字列 "raw" | 500 INTERNAL_ERROR の固定の文言、error で unexpected_error と値をログに出す | B11-F, B12-F, B13-F | captureLogger | 一部 TC-NOUS52_DEV-11（Error だけ） |  | TC-UT_ADM-017 toAppError は Error でない値（文字列）も 500 INTERNAL_ERROR の固定の文言にする | Hono は Error でない値の throw を onError に渡さないため、errorHandler ではなく toAppError を直接呼んで確かめる（確認事項 1） |
| TC-UT_ADM-018 | toAppError（ログの水準） | 正常系 | 同値分割 | AppError は info、入力の誤りは debug、想定外の例外は error の水準でログに出す | なし | AppError、ZodError、Error | info app_error、debug validation_error、error unexpected_error（どれも path 付き） | B11-T, B12-T, B13-F | captureLogger | 一部 TC-NOUS52_DEV-11（error だけ） |  | TC-UT_ADM-018 AppError は info、入力の誤りは debug、想定外の例外は error の水準でログに出す |  |
| TC-UT_ADM-019 | requireAdminSession | 異常系 | 境界値 | 値が空の Cookie は Cookie がないものとして 401 にする | なし | Cookie aisns_admin=（値が空） | 401 ADMIN_UNAUTHORIZED | B19-T | 一時 DB（createTestDb）、FakeClock（TEST_NOW = 2026-10-20T00:00:00.000Z） | 一部 TC-NOUS52_DEV-02（Cookie なしと知らない値） |  | TC-UT_ADM-019 値が空の Cookie は Cookie がないものとして 401 にする |  |
| TC-UT_ADM-020 | requireAdminSession | 異常系 | 同値分割 | DB の session_hash をそのまま Cookie に入れても通らない（Cookie の値をハッシュして探す） | 有効なセッション | DB の session_hash をそのまま Cookie に入れる | 401（Cookie の値を SHA-256 にして探すため、DB の値が漏れても入れない） | B19-F, B20-T | 一時 DB（createTestDb）、FakeClock（TEST_NOW = 2026-10-20T00:00:00.000Z） | なし |  | TC-UT_ADM-020 DB の session_hash をそのまま Cookie に入れても通らない（Cookie の値をハッシュして探す） |  |
| TC-UT_ADM-021 | requireAdminSession | 異常系 | 境界値 | 最終操作からちょうど 60 分のセッションは 401 にし、最終操作の時刻を更新しない | 最終操作が TEST_NOW のセッション | 60 分ちょうど後に要求 | 401 で、last_seen_at を更新しない | B20-T | 一時 DB（createTestDb）、FakeClock（TEST_NOW = 2026-10-20T00:00:00.000Z） | 一部 TC-NOUS52_DEV-04（findActiveSession だけで、更新しないことを見ていない） |  | TC-UT_ADM-021 最終操作からちょうど 60 分のセッションは 401 にし、最終操作の時刻を更新しない |  |
| TC-UT_ADM-022 | deleteExpiredSessions | 正常系 | 境界値 | deleteExpiredSessions は作成から 8 時間ちょうど・最終操作から 60 分ちょうどのものを消し、1 ms 手前のものは残す | 作成から 8 時間ちょうど／1 ms 手前、最終操作から 60 分ちょうど／1 ms 手前の 4 件 | 8 時間後の時刻で削除 | ちょうどの 2 件を消し、1 ms 手前の 2 件を残す（findActiveSession の境界と同じ） |  | 一時 DB（createTestDb）、FakeClock（TEST_NOW = 2026-10-20T00:00:00.000Z） | 一部 TC-NOUS52_DEV-05（境界から離れた値だけ） |  | TC-UT_ADM-022 deleteExpiredSessions は作成から 8 時間ちょうど・最終操作から 60 分ちょうどのものを消し、1 ms 手前のものは残す |  |

## 3. 確認事項・バグの疑い

- 確認事項 1：Hono は Error でない値（文字列など）の throw を onError（errorHandler）に渡さず、そのまま投げ直す。@hono/node-server では JSON でない 500 になり、エラーの本文の形（error.code など）にならない。今の管理サーバーのコードは Error 以外を投げないので影響はない。toAppError 自体は Error でない値も INTERNAL_ERROR にする（TC-UT_ADM-017）。
- 分岐 B3 の真（staticDir を省いて apps/admin/dist を使う）は、画面のビルドの有無に結果が左右されるため単体テストでは通さない。B4・B5 は一時ディレクトリで確かめている。
- context.ts は型だけで実行されるコードがないため、ケースを作らない（型の誤りは pnpm typecheck で見る）。
