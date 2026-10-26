# 単体テスト観点表：サーバーの共通ライブラリ（apps/server/src/lib）

| 項目 | 内容 |
|---|---|
| 関連チケット | NOUS-90 |
| 作成者 | Jane Doe（テスト担当） |
| 作成日 | 2026-10-23 |
| 対象 | apps/server/src/lib/errors.ts, apps/server/src/lib/env.ts, apps/server/src/lib/ids.ts, apps/server/src/lib/sql.ts, apps/server/src/lib/tokens.ts, apps/server/src/lib/logger.ts |
| 言語 / フレームワーク | TypeScript / Vitest 2.1.9（environment: node） |
| テストファイル | apps/server/src/lib/errors.test.ts（実装時、NOUS-44・76）, apps/server/src/lib/env.test.ts（実装時、NOUS-44・76）, apps/server/src/lib/ids.test.ts（実装時、NOUS-44・76）, apps/server/src/lib/sql.test.ts（実装時、NOUS-44・76）, apps/server/src/lib/tokens.test.ts（実装時、NOUS-44・76）, apps/server/src/lib/logger.test.ts（実装時、NOUS-44・76）, apps/server/src/lib/errors.ut.test.ts（単体テストで追加）, apps/server/src/lib/env.ut.test.ts（単体テストで追加）, apps/server/src/lib/ids.ut.test.ts（単体テストで追加）, apps/server/src/lib/sql.ut.test.ts（単体テストで追加）, apps/server/src/lib/tokens.ut.test.ts（単体テストで追加）, apps/server/src/lib/logger.ut.test.ts（単体テストで追加） |
| 外部依存 | process.env（loadEnv は引数で差し替える）, node:crypto, node:fs（fileSink）, process.stdout（stdoutSink）, SQLite（LIKE の確認だけ、一時 DB）, @nous/shared の ERROR_CODES（突き合わせだけ） |
| 入力にした設計書 | BE 詳細設計 admin_auth 1章・4章・6章（errors・ids・tokens・logger・cursor）, BE 詳細設計 admin_data 4章 escapeLike, 基本設計書 概要 7章（エラーコード）・8章（機密情報管理）・9章（環境変数一覧） |

このファイルは `docs/test/unit/_build/build_matrix.py` で JSON から作る。直すときは JSON を直して作り直す。

## 1. 分岐の一覧

| ID | 条件 | 場所 |
|---|---|---|
| B1 | options.message が指定されている（?? の左） | errors.ts:61 |
| B2 | options.fields が指定されている（?? の左） | errors.ts:65 |
| B3 | typeof problems === "string" | errors.ts:93-94 |
| B4 | !parsed.success（Zod の検証の失敗） | env.ts:66 |
| B5 | 空白だけの文字列は未設定にする（optional の preprocess） | env.ts:38 |
| B6 | ポートが整数の字でない・1〜65535 の外 | env.ts:42-44 |
| B7 | llmMode === "cloudflare" | env.ts:77・95 |
| B8 | !raw.CLOUDFLARE_ACCOUNT_ID | env.ts:78 |
| B9 | !raw.CLOUDFLARE_API_TOKEN | env.ts:79 |
| B10 | observerPort === adminPort | env.ts:81 |
| B11 | clock === "fake" && nodeEnv === "production" | env.ts:84 |
| B12 | problems.length > 0 | env.ts:87 |
| B13 | !Number.isInteger(bytes) \|\| bytes < 1 | tokens.ts:6 |
| B14 | left.length !== right.length（バイト数） | tokens.ts:21 |
| B15 | value === null \|\| typeof value !== "object" | logger.ts:36 |
| B16 | seen.has(value)（循環） | logger.ts:39 |
| B17 | value instanceof Date | logger.ts:42 |
| B18 | Array.isArray(value) | logger.ts:48 |
| B19 | value instanceof Error | logger.ts:52 |
| B20 | isSecretKey(key) | logger.ts:55 |
| B21 | 水準が設定より下（出さない） | logger.ts:103 |
| B22 | options.sinks が無い（標準出力にする） | logger.ts:98 |
| B23 | options.now が無い（実時刻にする） | logger.ts:99 |

## 2. ケースの一覧（73 件。うち新しく足したもの 38 件）

| ID | 対象 | 分類 | 技法 | 観点 | 前提 | 入力 | 期待結果 | 分岐 | モック | 既存テストとの対応 | バグの疑い | テスト名 | 備考 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| TC-NOUS44_DEV-01 | ERROR_CODES | 正常系 | 開発者テスト | エラーコードの定数が設計書のコードと状態に一致する | なし | テストコードのとおり | エラーコードの定数が設計書のコードと状態に一致する |  | なし | 実装時のテスト（NOUS-44） |  | TC-NOUS44_DEV-01 エラーコードの定数が設計書のコードと状態に一致する |  |
| TC-NOUS44_DEV-02 | AppError / isAppError | 正常系 | 開発者テスト | AppError がコードから status と既定のメッセージを引く | なし | テストコードのとおり | AppError がコードから status と既定のメッセージを引く | B1-F, B2-F | なし | 実装時のテスト（NOUS-44） |  | TC-NOUS44_DEV-02 AppError がコードから status と既定のメッセージを引く |  |
| TC-NOUS44_DEV-03 | AppError.toBody | 正常系 | 開発者テスト | メッセージと fields を差し替え、エラーの本文の形にする | なし | テストコードのとおり | メッセージと fields を差し替え、エラーの本文の形にする | B1-T, B2-T | なし | 実装時のテスト（NOUS-44） |  | TC-NOUS44_DEV-03 メッセージと fields を差し替え、エラーの本文の形にする |  |
| TC-NOUS44_DEV-04 | AppError | 正常系 | 開発者テスト | INTERNAL_ERROR の既定のメッセージが固定の文言である | なし | テストコードのとおり | INTERNAL_ERROR の既定のメッセージが固定の文言である | B1-F | なし | 実装時のテスト（NOUS-44） |  | TC-NOUS44_DEV-04 INTERNAL_ERROR の既定のメッセージが固定の文言である |  |
| TC-NOUS44_DEV-05 | ConfigError | 正常系 | 開発者テスト | ConfigError が問題をすべて持つ | なし | テストコードのとおり | ConfigError が問題をすべて持つ | B3-F | なし | 実装時のテスト（NOUS-44） |  | TC-NOUS44_DEV-05 ConfigError が問題をすべて持つ |  |
| TC-NOUS44_DEV-32 | ConfigError | 正常系 | 開発者テスト | ConfigError が1つの問題の文字列と cause を受ける | なし | テストコードのとおり | ConfigError が1つの問題の文字列と cause を受ける | B3-T | なし | 実装時のテスト（NOUS-44） |  | TC-NOUS44_DEV-32 ConfigError が1つの問題の文字列と cause を受ける |  |
| TC-NOUS76_DEV-01 | ConfigError（再輸出） | 正常系 | 開発者テスト | clock・generationConfig が使う ConfigError は lib/errors.ts のものと同じ | なし | テストコードのとおり | clock・generationConfig が使う ConfigError は lib/errors.ts のものと同じ |  | なし | 実装時のテスト（NOUS-76） |  | TC-NOUS76_DEV-01 clock・generationConfig が使う ConfigError は lib/errors.ts のものと同じ |  |
| TC-NOUS76_DEV-02 | CancelledError（再輸出） | 正常系 | 開発者テスト | clock が使う CancelledError は lib/errors.ts のものと同じ | なし | テストコードのとおり | clock が使う CancelledError は lib/errors.ts のものと同じ |  | なし | 実装時のテスト（NOUS-76） |  | TC-NOUS76_DEV-02 clock が使う CancelledError は lib/errors.ts のものと同じ |  |
| TC-NOUS76_DEV-03 | CancelledError | 正常系 | 開発者テスト | CancelledError の既定の文言と name、cause を持つ | なし | テストコードのとおり | CancelledError の既定の文言と name、cause を持つ |  | なし | 実装時のテスト（NOUS-76） |  | TC-NOUS76_DEV-03 CancelledError の既定の文言と name、cause を持つ |  |
| TC-UT_LIB-011 | AppError | 正常系 | 同値分割 | AppError は Error の派生で、name と cause を持つ | なし | new AppError('CONFLICT', { cause }) | Error の派生、name は AppError、cause はそのもの、status は 409 | B1-F, B2-F | なし | なし（DEV-02 は name・cause・Error の派生を見ていない） |  | TC-UT_LIB-011 AppError は Error の派生で、name と cause を持つ |  |
| TC-UT_LIB-012 | AppError | 正常系 | 分岐網羅 | message だけを渡すと fields は空、fields だけを渡すと message は既定の文言になる | なし | message だけ、fields だけを別々に渡す | message だけ：fields は {}。fields だけ：message は VALIDATION_ERROR の既定の文言 | B1-T, B1-F, B2-T, B2-F | なし | 一部 TC-NOUS44_DEV-03（両方を同時に渡すだけ） |  | TC-UT_LIB-012 message だけを渡すと fields は空、fields だけを渡すと message は既定の文言になる |  |
| TC-UT_LIB-013 | isAppError | 異常系 | 同値分割 | isAppError は形だけ似たオブジェクト・null・undefined を AppError としない | なし | AppError と同じ項目を持つただのオブジェクト、null、undefined | どれも false |  | なし | 一部 TC-NOUS44_DEV-02（Error だけ） |  | TC-UT_LIB-013 isAppError は形だけ似たオブジェクト・null・undefined を AppError としない |  |
| TC-UT_LIB-014 | ConfigError | 正常系 | 境界値 | ConfigError に1件だけの配列を渡すと、まとめの文言で1件を持つ | なし | 問題が 1 件だけの配列 | problems は 1 件、message は「設定に誤りがあります: 」付き、Error の派生で AppError ではない | B3-F | なし | 一部 TC-NOUS44_DEV-05（2 件の配列だけ） |  | TC-UT_LIB-014 ConfigError に1件だけの配列を渡すと、まとめの文言で1件を持つ |  |
| TC-UT_LIB-015 | ERROR_CODES（サーバーと @nous/shared） | 正常系 | 依存 | サーバーのエラーコードと @nous/shared の ERROR_CODES が同じ集合である | なし | サーバーの ERROR_CODES のキーと @nous/shared の ERROR_CODES | 同じ 27 種の集合（基本設計書 概要 7章・admin_auth v1.1 の 409 CONFLICT を含む） |  | なし（@nous/shared を読む） | なし（DEV-01 はサーバー側だけ） | @nous/shared の ERROR_CODES に CONFLICT がない（26 種）。概要 v3.11・admin_auth v1.1 で追加された 409 CONFLICT が共有の型に入っていない（疑い 1） | TC-UT_LIB-015 サーバーのエラーコードと @nous/shared の ERROR_CODES が同じ集合である |  |
| TC-NOUS44_DEV-23 | loadEnv | 正常系 | 開発者テスト | 何も設定しなければ概要 9章の既定値になる | なし | テストコードのとおり | 何も設定しなければ概要 9章の既定値になる | B4-F, B7-F, B10-F, B11-F, B12-F | なし | 実装時のテスト（NOUS-44） |  | TC-NOUS44_DEV-23 何も設定しなければ概要 9章の既定値になる |  |
| TC-NOUS44_DEV-24 | loadEnv | 正常系 | 開発者テスト | 設定した値を読み、ポートを数値にする | なし | テストコードのとおり | 設定した値を読み、ポートを数値にする | B5-F, B6-F | なし | 実装時のテスト（NOUS-44） |  | TC-NOUS44_DEV-24 設定した値を読み、ポートを数値にする |  |
| TC-NOUS44_DEV-25 | loadEnv | 正常系 | 開発者テスト | 空の文字列は未設定として既定値にする | なし | テストコードのとおり | 空の文字列は未設定として既定値にする | B5-T | なし | 実装時のテスト（NOUS-44） |  | TC-NOUS44_DEV-25 空の文字列は未設定として既定値にする |  |
| TC-NOUS44_DEV-26 | loadEnv | 正常系 | 開発者テスト | production の DB の既定は data/aisns.db | なし | テストコードのとおり | production の DB の既定は data/aisns.db | B11-F | なし | 実装時のテスト（NOUS-44） |  | TC-NOUS44_DEV-26 production の DB の既定は data/aisns.db |  |
| TC-NOUS44_DEV-27 | loadEnv | 異常系 | 開発者テスト | cloudflare のときは認証情報を読み、なければエラーにする | なし | テストコードのとおり | cloudflare のときは認証情報を読み、なければエラーにする | B7-T, B8-T, B8-F, B9-T, B9-F, B12-T | なし | 実装時のテスト（NOUS-44） |  | TC-NOUS44_DEV-27 cloudflare のときは認証情報を読み、なければエラーにする |  |
| TC-NOUS44_DEV-28 | loadEnv | 異常系 | 開発者テスト | 列挙の外の値・範囲外のポートをまとめてエラーにする | なし | テストコードのとおり | 列挙の外の値・範囲外のポートをまとめてエラーにする | B4-T, B6-T | なし | 実装時のテスト（NOUS-44） |  | TC-NOUS44_DEV-28 列挙の外の値・範囲外のポートをまとめてエラーにする |  |
| TC-NOUS44_DEV-29 | loadEnv | 異常系 | 開発者テスト | 観察と管理のポートが同じならエラーにする | なし | テストコードのとおり | 観察と管理のポートが同じならエラーにする | B10-T, B12-T | なし | 実装時のテスト（NOUS-44） |  | TC-NOUS44_DEV-29 観察と管理のポートが同じならエラーにする |  |
| TC-NOUS44_DEV-30 | loadEnv | 異常系 | 開発者テスト | production で fake の時計はエラーにする | なし | テストコードのとおり | production で fake の時計はエラーにする | B11-T, B12-T | なし | 実装時のテスト（NOUS-44） |  | TC-NOUS44_DEV-30 production で fake の時計はエラーにする |  |
| TC-NOUS44_DEV-31 | loadEnv | 異常系 | 開発者テスト | エラーのメッセージに API トークンの値を出さない | なし | テストコードのとおり | エラーのメッセージに API トークンの値を出さない | B4-T | なし | 実装時のテスト（NOUS-44） |  | TC-NOUS44_DEV-31 エラーのメッセージに API トークンの値を出さない |  |
| TC-UT_LIB-016 | loadEnv | 正常系 | 境界値 | ポートの下限・上限を受け付ける | なし | AISNS_ADMIN_PORT = "1"、"65535" | adminPort が 1、65535（数値） | B4-F, B6-F | なし | 一部 TC-NOUS44_DEV-28（範囲外の 0・65536 だけ） |  | TC-UT_LIB-016 ポートの下限・上限を受け付ける |  |
| TC-UT_LIB-017 | loadEnv | 異常系 | 同値分割 | 整数の字だけでないポートはエラーにする | なし | AISNS_OBSERVER_PORT = "-1"、"80.5"、"0x50"、"8080a" | ConfigError。問題はすべて AISNS_OBSERVER_PORT のもの | B4-T, B6-T | なし | 一部 TC-NOUS44_DEV-28（"abc" だけ） |  | TC-UT_LIB-017 整数の字だけでないポートはエラーにする | "-1"・"8080a" では同じ文言の問題が 2 件並ぶ（確認事項 4） |
| TC-UT_LIB-018 | loadEnv | 異常系 | 分岐網羅 | 管理のポートだけを 8080 にすると、観察の既定のポートとぶつかってエラーにする | なし | AISNS_ADMIN_PORT = "8080" だけ（観察は既定の 8080） | 問題は「AISNS_ADMIN_PORT: AISNS_OBSERVER_PORT と別のポートにしてください」の 1 件 | B10-T, B12-T | なし | 一部 TC-NOUS44_DEV-29（両方を指定したときだけ） |  | TC-UT_LIB-018 管理のポートだけを 8080 にすると、観察の既定のポートとぶつかってエラーにする |  |
| TC-UT_LIB-019 | loadEnv | 異常系 | 分岐網羅 | cloudflare で アカウント ID だけがあれば、API トークンの不足だけをエラーにする | なし | AISNS_LLM_MODE = cloudflare、CLOUDFLARE_ACCOUNT_ID だけ | 問題は CLOUDFLARE_API_TOKEN の不足の 1 件だけ | B7-T, B8-F, B9-T, B12-T | なし | 一部 TC-NOUS44_DEV-27（両方が無いときだけ） |  | TC-UT_LIB-019 cloudflare で アカウント ID だけがあれば、API トークンの不足だけをエラーにする |  |
| TC-UT_LIB-020 | loadEnv | 異常系 | 境界値 | cloudflare で API トークンが空白だけなら、未設定としてエラーにする | なし | cloudflare、CLOUDFLARE_API_TOKEN = 空白 2 字 | 空白だけは未設定として、CLOUDFLARE_API_TOKEN の不足の 1 件 | B5-T, B7-T, B9-T, B12-T | なし | なし（DEV-25 は NODE_ENV・ポートの空だけ） |  | TC-UT_LIB-020 cloudflare で API トークンが空白だけなら、未設定としてエラーにする |  |
| TC-UT_LIB-021 | loadEnv | 正常系 | 分岐網羅 | fixed のときは Cloudflare の認証情報があっても読まない | なし | AISNS_LLM_MODE = fixed、Cloudflare の認証情報あり | cloudflare は null（認証情報を持ち回らない） | B7-F | なし | 一部 TC-NOUS44_DEV-23（認証情報が無いときだけ） |  | TC-UT_LIB-021 fixed のときは Cloudflare の認証情報があっても読まない |  |
| TC-UT_LIB-022 | loadEnv | 異常系 | エラー処理 | 意味の誤り（認証情報の不足・ポートの重複・production の fake）をまとめて1つの ConfigError にする | なし | production・cloudflare（認証情報なし）・両ポート 9000・fake の時計 | 4 件の問題を 1 つの ConfigError に、検査の順に並べる | B7-T, B8-T, B9-T, B10-T, B11-T, B12-T | なし | なし（DEV は 1 種類ずつ） |  | TC-UT_LIB-022 意味の誤り（認証情報の不足・ポートの重複・production の fake）をまとめて1つの ConfigError にする |  |
| TC-UT_LIB-023 | loadEnv | 正常系 | 分岐網羅 | production 以外では fake の時計を受け付ける | なし | NODE_ENV = development・test、AISNS_CLOCK = fake | clock は fake、dbPath は data/dev.db | B11-F | なし | 一部 TC-NOUS44_DEV-24（test だけ） |  | TC-UT_LIB-023 production 以外では fake の時計を受け付ける |  |
| TC-UT_LIB-024 | loadEnv | 正常系 | 同値分割 | バックアップ・固定応答の置き場所と、production の cloudflare の設定を読む | なし | production・cloudflare（認証情報あり）・AISNS_BACKUP_DIR・AISNS_FIXTURE_DIR・AISNS_LOG_LEVEL = error | すべての項目を読み、dbPath は data/aisns.db、ポートは既定 | B4-F, B7-T, B8-F, B9-F, B12-F | なし | なし（DEV はバックアップ・固定応答の置き場所を読んでいない） |  | TC-UT_LIB-024 バックアップ・固定応答の置き場所と、production の cloudflare の設定を読む |  |
| TC-NOUS44_DEV-06 | newUlid | 正常系 | 開発者テスト | newUlid が 26 字の ULID を返し、毎回ちがう | なし | テストコードのとおり | newUlid が 26 字の ULID を返し、毎回ちがう |  | なし | 実装時のテスト（NOUS-44） |  | TC-NOUS44_DEV-06 newUlid が 26 字の ULID を返し、毎回ちがう |  |
| TC-NOUS44_DEV-07 | newUlid | 正常系 | 開発者テスト | 渡した時刻が ULID の時刻の部分に入る | なし | テストコードのとおり | 渡した時刻が ULID の時刻の部分に入る |  | なし | 実装時のテスト（NOUS-44） |  | TC-NOUS44_DEV-07 渡した時刻が ULID の時刻の部分に入る |  |
| TC-NOUS44_DEV-08 | isUlid | 異常系 | 開発者テスト | isUlid が形の違う文字列を拒む | なし | テストコードのとおり | isUlid が形の違う文字列を拒む |  | なし | 実装時のテスト（NOUS-44） |  | TC-NOUS44_DEV-08 isUlid が形の違う文字列を拒む |  |
| TC-UT_LIB-025 | newUlid | 正常系 | 境界値 | 時刻 0 を渡すと、時刻の部分が 0000000000 の ULID になる | なし | timeMs = 0 | 先頭 10 字が 0000000000、decodeTime は 0、isUlid は true |  | なし | 一部 TC-NOUS44_DEV-07（2026-10-20 だけ） |  | TC-UT_LIB-025 時刻 0 を渡すと、時刻の部分が 0000000000 の ULID になる |  |
| TC-UT_LIB-026 | newUlid | 正常系 | 依存 | 同じ時刻を続けて渡しても、ちがう ULID になる（FakeClock で時刻が止まっているとき） | 時刻が止まっている（FakeClock の使い方を想定） | 同じ timeMs で 100 回 | 100 件すべてちがい、どれも時刻の部分は同じ |  | なし | 一部 TC-NOUS44_DEV-06（時刻を渡さない 2 件だけ） |  | TC-UT_LIB-026 同じ時刻を続けて渡しても、ちがう ULID になる（FakeClock で時刻が止まっているとき） |  |
| TC-UT_LIB-027 | isUlid | 異常系 | 同値分割 | Crockford の Base32 で使わない字を含めば ULID としない | なし | 26 字目が I・L・O・U | どれも false |  | なし | 一部 TC-NOUS44_DEV-08（I だけ） |  | TC-UT_LIB-027 Crockford の Base32 で使わない字を含めば ULID としない |  |
| TC-UT_LIB-028 | isUlid | 異常系 | 同値分割 | 小文字の ULID は ULID としない（ID は大文字で採番する） | なし | 小文字の ULID | false |  | なし | なし |  | TC-UT_LIB-028 小文字の ULID は ULID としない（ID は大文字で採番する） | ID は newUlid の大文字だけを使う前提。小文字を受け付けるかは設計書に記載がなく、実装の値 |
| TC-NOUS44_DEV-13 | escapeLike | 正常系 | 開発者テスト | escapeLike が \\ と % と _ を逃がす | なし | テストコードのとおり | escapeLike が \\ と % と _ を逃がす |  | なし | 実装時のテスト（NOUS-44） |  | TC-NOUS44_DEV-13 escapeLike が \\ と % と _ を逃がす |  |
| TC-NOUS44_DEV-14 | escapeLike | 正常系 | 開発者テスト | 特殊文字のない文字列はそのまま返す | なし | テストコードのとおり | 特殊文字のない文字列はそのまま返す |  | なし | 実装時のテスト（NOUS-44） |  | TC-NOUS44_DEV-14 特殊文字のない文字列はそのまま返す |  |
| TC-NOUS44_DEV-15 | likeContains / LIKE_ESCAPE_CHAR | 正常系 | 開発者テスト | likeContains が部分一致のパターンを作り、ESCAPE の文字が \\ である | なし | テストコードのとおり | likeContains が部分一致のパターンを作り、ESCAPE の文字が \\ である |  | なし | 実装時のテスト（NOUS-44） |  | TC-NOUS44_DEV-15 likeContains が部分一致のパターンを作り、ESCAPE の文字が \\ である |  |
| TC-UT_LIB-029 | escapeLike | 正常系 | 同値分割 | 特殊文字が続いても1字ずつ逃がす | なし | "%%__\\\\"（特殊文字が続く） | "\\%\\%\\_\\_\\\\\\\\"（1 字ずつ前に \ を付ける） |  | なし | 一部 TC-NOUS44_DEV-13（1 字ずつ離れているだけ） |  | TC-UT_LIB-029 特殊文字が続いても1字ずつ逃がす |  |
| TC-UT_LIB-030 | likeContains | 正常系 | 境界値 | 空の文字列の likeContains は %% になる | なし | "" | "%%" |  | なし | なし |  | TC-UT_LIB-030 空の文字列の likeContains は %% になる | 呼び出し側は q を 1 字以上に検証している（PostSearchQuerySchema） |
| TC-UT_LIB-031 | likeContains + SQLite の LIKE ESCAPE | 正常系 | 依存 | likeContains の値を ESCAPE '\\' で使うと特殊文字を字のまま探す | 一時 DB | % ・ _ ・ \ を含む検索語と、字のまま含む／含まない本文 | 字のまま含む本文だけが一致する |  | 一時 DB（createTestDb） | なし（DEV は文字列の変換だけで、SQLite で一致を見ていない） |  | TC-UT_LIB-031 likeContains の値を ESCAPE '\\' で使うと特殊文字を字のまま探す |  |
| TC-NOUS44_DEV-09 | randomToken | 正常系 | 開発者テスト | randomToken(32) が 43 字の Base64URL を返す | なし | テストコードのとおり | randomToken(32) が 43 字の Base64URL を返す | B13-F | なし | 実装時のテスト（NOUS-44） |  | TC-NOUS44_DEV-09 randomToken(32) が 43 字の Base64URL を返す |  |
| TC-NOUS44_DEV-10 | randomToken | 異常系 | 開発者テスト | randomToken が 1 未満・整数でない bytes を拒む | なし | テストコードのとおり | randomToken が 1 未満・整数でない bytes を拒む | B13-T | なし | 実装時のテスト（NOUS-44） |  | TC-NOUS44_DEV-10 randomToken が 1 未満・整数でない bytes を拒む |  |
| TC-NOUS44_DEV-11 | sha256Hex | 正常系 | 開発者テスト | sha256Hex が 64 字の 16 進を返す | なし | テストコードのとおり | sha256Hex が 64 字の 16 進を返す |  | なし | 実装時のテスト（NOUS-44） |  | TC-NOUS44_DEV-11 sha256Hex が 64 字の 16 進を返す |  |
| TC-NOUS44_DEV-12 | safeEqual | 正常系 | 開発者テスト | safeEqual が一致・不一致・長さ違いを判定する | なし | テストコードのとおり | safeEqual が一致・不一致・長さ違いを判定する | B14-T, B14-F | なし | 実装時のテスト（NOUS-44） |  | TC-NOUS44_DEV-12 safeEqual が一致・不一致・長さ違いを判定する |  |
| TC-UT_LIB-032 | randomToken | 正常系 | 境界値 | randomToken は bytes に応じた長さの Base64URL をパディングなしで返す | なし | bytes = 1、33 | 2 字、44 字の Base64URL（= を付けない） | B13-F | なし | 一部 TC-NOUS44_DEV-09（32 バイトだけ） |  | TC-UT_LIB-032 randomToken は bytes に応じた長さの Base64URL をパディングなしで返す |  |
| TC-UT_LIB-033 | randomToken | 異常系 | 同値分割 | randomToken は負の数・NaN・無限大・数値でない値を RangeError にする | なし | bytes = -1、NaN、Infinity、文字列 "32" | どれも RangeError | B13-T | なし | 一部 TC-NOUS44_DEV-10（0 と 1.5 だけ） |  | TC-UT_LIB-033 randomToken は負の数・NaN・無限大・数値でない値を RangeError にする |  |
| TC-UT_LIB-034 | sha256Hex | 正常系 | 同値分割 | sha256Hex は文字列を UTF-8 として計算する | なし | "あ"（UTF-8 で 3 バイト） | dc5a4d3d…494d（UTF-8 のバイト列の SHA-256） |  | なし | 一部 TC-NOUS44_DEV-11（ASCII だけ） |  | TC-UT_LIB-034 sha256Hex は文字列を UTF-8 として計算する |  |
| TC-UT_LIB-035 | safeEqual | 正常系 | 境界値 | safeEqual は空の文字列どうしを一致とする | なし | "" と "" | true | B14-F | なし | なし |  | TC-UT_LIB-035 safeEqual は空の文字列どうしを一致とする |  |
| TC-UT_LIB-036 | safeEqual | 異常系 | 境界値 | safeEqual は字数が同じでもバイト数が違えば、例外にせず不一致とする | なし | "あ" と "a"（字数は同じ、バイト数は 3 と 1） | 例外にならず false | B14-T | なし | 一部 TC-NOUS44_DEV-12（字数も違うときだけ） |  | TC-UT_LIB-036 safeEqual は字数が同じでもバイト数が違えば、例外にせず不一致とする |  |
| TC-UT_LIB-037 | safeEqual | 異常系 | 同値分割 | safeEqual はバイト数が同じで中身が違えば不一致とする | なし | "あ" と "abc"（どちらも 3 バイト） | false | B14-F | なし | なし |  | TC-UT_LIB-037 safeEqual はバイト数が同じで中身が違えば不一致とする |  |
| TC-NOUS44_DEV-16 | redactSecrets | 正常系 | 開発者テスト | redactSecrets が設計書の秘密のキーと Cookie を伏せる | なし | テストコードのとおり | redactSecrets が設計書の秘密のキーと Cookie を伏せる | B15-T, B19-F, B20-T, B20-F | なし | 実装時のテスト（NOUS-44） |  | TC-NOUS44_DEV-16 redactSecrets が設計書の秘密のキーと Cookie を伏せる |  |
| TC-NOUS44_DEV-17 | isSecretKey | 正常系 | 開発者テスト | 大文字小文字・区切りの違いと、token・password で終わるキーも伏せる | なし | テストコードのとおり | 大文字小文字・区切りの違いと、token・password で終わるキーも伏せる |  | なし | 実装時のテスト（NOUS-44） |  | TC-NOUS44_DEV-17 大文字小文字・区切りの違いと、token・password で終わるキーも伏せる |  |
| TC-NOUS44_DEV-18 | redactSecrets | 正常系 | 開発者テスト | 入れ子のオブジェクト・配列の中も伏せ、元の値は変えない | なし | テストコードのとおり | 入れ子のオブジェクト・配列の中も伏せ、元の値は変えない | B15-F, B17-F, B18-T, B18-F, B20-T | なし | 実装時のテスト（NOUS-44） |  | TC-NOUS44_DEV-18 入れ子のオブジェクト・配列の中も伏せ、元の値は変えない |  |
| TC-NOUS44_DEV-19 | redactSecrets | 正常系 | 開発者テスト | 循環する参照で止まらず、同じ値を2か所で指すだけなら両方出す | なし | テストコードのとおり | 循環する参照で止まらず、同じ値を2か所で指すだけなら両方出す | B16-T, B16-F | なし | 実装時のテスト（NOUS-44） |  | TC-NOUS44_DEV-19 循環する参照で止まらず、同じ値を2か所で指すだけなら両方出す |  |
| TC-NOUS44_DEV-20 | createLogger | 正常系 | 開発者テスト | 1行の JSON に時刻・水準・メッセージ・項目を出し、秘密を伏せる | なし | テストコードのとおり | 1行の JSON に時刻・水準・メッセージ・項目を出し、秘密を伏せる | B21-F, B22-F, B23-F | なし | 実装時のテスト（NOUS-44） |  | TC-NOUS44_DEV-20 1行の JSON に時刻・水準・メッセージ・項目を出し、秘密を伏せる |  |
| TC-NOUS44_DEV-21 | createLogger | 正常系 | 開発者テスト | 設定した水準より下のログは出さない | なし | テストコードのとおり | 設定した水準より下のログは出さない | B21-T, B21-F | なし | 実装時のテスト（NOUS-44） |  | TC-NOUS44_DEV-21 設定した水準より下のログは出さない |  |
| TC-NOUS44_DEV-22 | createLogger.child / redactSecrets | 正常系 | 開発者テスト | Error をスタック付きで出し、child の項目を毎行に付ける | なし | テストコードのとおり | Error をスタック付きで出し、child の項目を毎行に付ける | B19-T | なし | 実装時のテスト（NOUS-44） |  | TC-NOUS44_DEV-22 Error をスタック付きで出し、child の項目を毎行に付ける |  |
| TC-UT_LIB-038 | redactSecrets | 正常系 | 分岐網羅 | redactSecrets は null・数値・文字列・真偽値をそのまま返す | なし | null、42、"token"、false | そのまま返す | B15-T | なし | なし |  | TC-UT_LIB-038 redactSecrets は null・数値・文字列・真偽値をそのまま返す |  |
| TC-UT_LIB-039 | redactSecrets | 正常系 | 分岐網羅 | Date は ISO 8601 の文字列にする（いちばん外と入れ子の両方） | なし | Date、{ at: Date } | ISO 8601 の文字列 | B15-F, B17-T | なし | なし |  | TC-UT_LIB-039 Date は ISO 8601 の文字列にする（いちばん外と入れ子の両方） |  |
| TC-UT_LIB-040 | redactSecrets | 正常系 | 分岐網羅 | 秘密のキーの値がオブジェクトや配列でも、まるごと伏せる | なし | password がオブジェクト、token が配列 | どちらも *** にまるごと置き換える | B20-T | なし | 一部 TC-NOUS44_DEV-16（値が文字列のときだけ） |  | TC-UT_LIB-040 秘密のキーの値がオブジェクトや配列でも、まるごと伏せる |  |
| TC-UT_LIB-041 | redactSecrets | 正常系 | 分岐網羅 | Error は name・message・stack と、自分の項目（AppError の code・fields など）を出し、秘密の項目は伏せる | なし | AppError に csrfToken の項目を足したもの | name・message・stack・code・status・fields を出し、csrfToken は *** | B19-T, B20-T, B20-F | なし | 一部 TC-NOUS44_DEV-22（ただの Error の message・stack だけ） |  | TC-UT_LIB-041 Error は name・message・stack と、自分の項目（AppError の code・fields など）を出し、秘密の項目は伏せる |  |
| TC-UT_LIB-042 | isSecretKey | 正常系 | 同値分割 | isSecretKey は secret で終わるキーも秘密とし、似ているだけのキーは秘密としない | なし | clientSecret、x_api_token、Set-Cookie、COOKIE、secretary、max_tokens | 前の 4 つは true、後の 2 つは false |  | なし | 一部 TC-NOUS44_DEV-17（secret で終わるキーと Cookie の大文字を見ていない） |  | TC-UT_LIB-042 isSecretKey は secret で終わるキーも秘密とし、似ているだけのキーは秘密としない |  |
| TC-UT_LIB-043 | createLogger | 正常系 | 境界値 | 水準の下限・上限（%s）で出すログが決まる | なし | level = debug、error で 4 つの水準を 1 回ずつ | debug：4 つとも出す。error：error だけ | B21-T, B21-F | なし | 一部 TC-NOUS44_DEV-21（warn だけ） |  | TC-UT_LIB-043 水準の下限・上限（%s）で出すログが決まる |  |
| TC-UT_LIB-044 | createLogger | 正常系 | 分岐網羅 | 水準を指定しなければ info 以上を出す | なし | level を指定しない | info 以上を出し、debug は出さない | B21-T, B21-F | なし | なし |  | TC-UT_LIB-044 水準を指定しなければ info 以上を出す |  |
| TC-UT_LIB-045 | createLogger | 正常系 | 分岐網羅 | 出力先が複数なら、同じ1行をそれぞれに渡す | なし | 出力先 2 つ | 同じ 1 行をそれぞれに 1 回ずつ渡す | B22-F | なし | なし |  | TC-UT_LIB-045 出力先が複数なら、同じ1行をそれぞれに渡す |  |
| TC-UT_LIB-046 | createLogger.child | 正常系 | 同値分割 | child を重ねると項目を合わせ、呼び出しの項目が child の項目より優先される | なし | child を 2 回重ね、呼び出しで cycleNo を上書き | module・cycleNo（呼び出しの値）・worldId をすべて 1 行に出す |  | なし | 一部 TC-NOUS44_DEV-22（1 回だけ） |  | TC-UT_LIB-046 child を重ねると項目を合わせ、呼び出しの項目が child の項目より優先される |  |
| TC-UT_LIB-047 | createLogger / stdoutSink | 正常系 | 依存 | 出力先を指定しなければ、標準出力に1行ずつ改行付きで書く | なし | 出力先を指定しない | 標準出力に JSON の 1 行＋改行を書く | B22-T | process.stdout.write を vi.spyOn で差し替え | なし |  | TC-UT_LIB-047 出力先を指定しなければ、標準出力に1行ずつ改行付きで書く |  |
| TC-UT_LIB-048 | fileSink | 正常系 | 依存 | fileSink はディレクトリがなければ作り、1行ずつ追記する | 一時ディレクトリ | まだ無い logs/nested/app.log に 2 行 | ディレクトリを作り、2 行を改行付きで追記する |  | 一時ディレクトリ（mkdtemp。終わったら消す） | なし |  | TC-UT_LIB-048 fileSink はディレクトリがなければ作り、1行ずつ追記する |  |

## 3. 確認事項・バグの疑い

- 疑い 1：@nous/shared の ERROR_CODES に CONFLICT がない（TC-UT_LIB-015）。基本設計書 概要 v3.11・BE 詳細設計 admin_auth v1.1 で POST /admin/api/invitations の 409 CONFLICT が追加され、サーバー（lib/errors.ts）には入っているが、共有の ErrorCode の型に入っていない。管理画面の ApiError.code は ErrorCode を型にしているため、招待の上限（409 CONFLICT）を型どおりに分けられない。実行時は code がそのまま渡るので表示は崩れない。重要度の目安：低。
- 確認事項 1：loadEnv は Zod の検証で誤りがあるとその時点で ConfigError を投げ、意味の検査（Cloudflare の認証情報・ポートの重複・production の fake）は行わない。「すべての問題を並べる」のは段階ごと。設計書に記載はなく、起動を止める動きは正しいので、疑いではなく確認事項とした。
- 確認事項 2：createLogger は time・level・msg のあとに呼び出しの項目を重ねるため、項目に time・level・msg があると上書きされる。設計書は項目の名前の衝突を決めていない。今のコードに level・msg を項目に渡す呼び出しがないかは、各機能の観点で見る。
- 確認事項 3：秘密のキーの一覧（設計書どおり）に passwordHash・password_hash は入らない。管理者のパスワードのハッシュをログに出す呼び出しがないかを、NOUS-91（管理者の認証）で確かめる。
- 確認事項 4：ポートが "-1"・"8080a" のとき、同じ変数の同じ文言の問題が 2 件並ぶ（正規表現と範囲の両方の検査が残るため）。起動を止める動きは正しく、表示が重複するだけ（TC-UT_LIB-017 は件数ではなく変数名で確かめている）。
- 分岐 B23 の真（now を渡さないと実時刻を使う）は、実時刻に頼るテストを書かない決まり（README 6.2）のため通さない。呼び出し側は Clock の now を渡す。
- cursor.ts は NOUS-89 の見本（docs/test/unit/NOUS-89/観点表_cursor.json、TC-UT_LIB-001〜010）で扱ったため、この表には入れていない。
