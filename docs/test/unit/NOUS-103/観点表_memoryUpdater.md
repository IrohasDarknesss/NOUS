# 単体テスト観点表：記憶の更新（generation/memoryUpdater.ts）

| 項目 | 内容 |
|---|---|
| 関連チケット | NOUS-103 |
| 作成者 | Takaya Ishikawa（開発担当） |
| 作成日 | 2026-10-23 |
| 対象 | apps/server/src/generation/memoryUpdater.ts |
| 言語 / フレームワーク | TypeScript / Vitest 2.1.9（environment: node） |
| テストファイル | apps/server/src/generation/memoryUpdater.test.ts（実装時、NOUS-62）, apps/server/src/generation/memoryUpdater.ut.test.ts（単体テストで追加） |
| 外部依存 | 一時 DB（createTestDb）。前提のデータは generationSeed と applyAction（commitAction と同じ順で反映してから更新する）, 時刻は引数の nowIso（2026-10-22T09:00:00.000Z）で固定。世界内時間は行動ごとに 10 秒ずつ進める |
| 入力にした設計書 | 行動生成とプロンプトの設計 8章, BE 詳細設計 generation 3章 upsertMemory・4章 updateMemories, NOUS-62 の実装のコメント（非表示の投稿を記憶に入れない） |

このファイルは `docs/test/unit/_build/build_matrix.py` で JSON から作る。直すときは JSON を直して作り直す。

## 1. 分岐の一覧

| ID | 条件 | 場所 |
|---|---|---|
| B1 | joinLines：次の行を足すと上限を超える（break） | memoryUpdater.ts:35 |
| B2 | joinLines：2 行目以降（区切りの改行を 1 字数える） | memoryUpdater.ts:34 |
| B3 | clip：字数が n 以下 | memoryUpdater.ts:26 |
| B4 | recent_posts の行：post | memoryUpdater.ts:76 |
| B5 | recent_posts の行：reply | memoryUpdater.ts:78 |
| B6 | recent_posts の行：like・follow・unfollow（default） | memoryUpdater.ts:80 |
| B7 | relationship の並び：回数が同じならフォロー中を先に | memoryUpdater.ts:130 |
| B8 | relationship の並び：フォローも同じならハンドルの順 | memoryUpdater.ts:130 |
| B9 | updateMemories：action が none | memoryUpdater.ts:190 |
| B10 | updateMemories：action が reply（conversation_summary を作る） | memoryUpdater.ts:195 |

## 2. ケースの一覧（20 件。うち新しく足したもの 14 件）

| ID | 対象 | 分類 | 技法 | 観点 | 前提 | 入力 | 期待結果 | 分岐 | モック | 既存テストとの対応 | バグの疑い | テスト名 | 備考 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| TC-NOUS62_DEV-31 | updateMemories | 正常系 | 開発者テスト | recent_posts に最近の行動（新しい順）と投稿の本文が入る | haruka の投稿 | minato が post・like・follow・reply | recent_posts が「最近の行動」4 行（新しい順）と「最近の投稿」2 行 | B1-F, B2-F, B2-T, B4-T, B5-T, B6-T, B9-F, B10-T | 一時 DB（createTestDb、マイグレーション済み）。generationSeed で世界・エージェント・生成イベントを入れる | 実装時のテスト（NOUS-62） |  | TC-NOUS62_DEV-31 recent_posts に最近の行動（新しい順）と投稿の本文が入る |  |
| TC-NOUS62_DEV-32 | updateMemories | 正常系 | 開発者テスト | recent_posts は行動 5 件・本文 5 件・400 字まで | 世界・minato | minato が 100 字超の post を 8 回 | 400 字以内、post の行は 5 行、最新の 7 番目が入り 2 番目は入らない | B1-T, B3-F | 一時 DB（createTestDb、マイグレーション済み）。generationSeed で世界・エージェント・生成イベントを入れる | 実装時のテスト（NOUS-62） |  | TC-NOUS62_DEV-32 recent_posts は行動 5 件・本文 5 件・400 字まで |  |
| TC-NOUS62_DEV-33 | updateMemories | 正常系 | 開発者テスト | relationship_summary は相手ごとの集計を多い順に並べる | haruka・zen・minato の投稿 | minato が follow・reply 2 回・like、haruka が minato に reply | minato は「@haruka：フォロー中、返信 2 回、返信を受けた 1 回」「@zen：いいね 1 回」、haruka は「@minato：返信 1 回、返信を受けた 2 回」 | B7-F, B8-F, B9-F | 一時 DB（createTestDb、マイグレーション済み）。generationSeed で世界・エージェント・生成イベントを入れる | 実装時のテスト（NOUS-62） |  | TC-NOUS62_DEV-33 relationship_summary は相手ごとの集計を多い順に並べる |  |
| TC-NOUS62_DEV-34 | updateMemories | 正常系 | 開発者テスト | conversation_summary は reply のときだけ作り、起点の先頭 40 字と最後の発言者 | haruka の 45 字の投稿 | minato の post、reply、haruka の reply、minato の reply | post では作らず、reply で「「起×40」最後の発言：@…」 | B3-F, B10-F, B10-T | 一時 DB（createTestDb、マイグレーション済み）。generationSeed で世界・エージェント・生成イベントを入れる | 実装時のテスト（NOUS-62） |  | TC-NOUS62_DEV-34 conversation_summary は reply のときだけ作り、起点の先頭 40 字と最後の発言者 |  |
| TC-NOUS62_DEV-35 | updateMemories | 正常系 | 開発者テスト | none では記憶を作らない、2 回目の更新は同じ行を上書きする | 世界・minato | none、post、post | none では作らず、post の後は recent_posts・relationship_summary の 2 行だけで、上書きされる | B9-T, B10-F | 一時 DB（createTestDb、マイグレーション済み）。generationSeed で世界・エージェント・生成イベントを入れる | 実装時のテスト（NOUS-62） |  | TC-NOUS62_DEV-35 none では記憶を作らない、2 回目の更新は同じ行を上書きする |  |
| TC-NOUS62_DEV-36 | clip | 正常系 | 開発者テスト | clip はコードポイントで切る | なし | clip(😀×3, 2)、clip(abc, 5) | 😀×2、abc | B3-T, B3-F | なし | 実装時のテスト（NOUS-62） |  | TC-NOUS62_DEV-36 clip はコードポイントで切る |  |
| TC-UT_MEM-001 | updateMemories | 正常系 | 同値分割 | 非表示にした自分の投稿は、recent_posts の行動にも本文にも入れない | minato の投稿を非表示にする | minato が post「公開の投稿」 | recent_posts に「公開の投稿」は入り、「非表示にされる投稿」は入らない | B4-T, B5-F, B6-F | 一時 DB（createTestDb、マイグレーション済み）。generationSeed で世界・エージェント・生成イベントを入れる | なし |  | TC-UT_MEM-001 非表示にした自分の投稿は、recent_posts の行動にも本文にも入れない | 設計書に記載なし。NOUS-62 の実装のコメント（非表示の投稿を記憶に入れない）による |
| TC-UT_MEM-002 | updateMemories | 正常系 | 分岐網羅 | unfollow は「- unfollow：@相手」として、follow より新しい行に入る | minato が haruka を follow | minato が haruka を unfollow | recent_posts = 最近の行動：／- unfollow：@haruka／- follow：@haruka／最近の投稿： | B6-T, B4-F, B5-F | 一時 DB（createTestDb、マイグレーション済み）。generationSeed で世界・エージェント・生成イベントを入れる | なし（DEV に unfollow の行はない） |  | TC-UT_MEM-002 unfollow は「- unfollow：@相手」として、follow より新しい行に入る |  |
| TC-UT_MEM-003 | updateMemories | 正常系 | 同値分割 | 本文の改行と続く空白は、空白 1 つにまとめて 1 行にする | 世界・minato | post「一行目\n\n二行目　 三行目」 | 行動の行も本文の行も「一行目 二行目 三行目」（改行・全角を含む空白の続きを 1 つに） | B4-T, B5-F, B6-F | 一時 DB（createTestDb、マイグレーション済み）。generationSeed で世界・エージェント・生成イベントを入れる | なし |  | TC-UT_MEM-003 本文の改行と続く空白は、空白 1 つにまとめて 1 行にする |  |
| TC-UT_MEM-004 | updateMemories | 正常系 | 境界値 | 行動の行は本文の先頭 30 字で切り、最近の投稿の行は本文をすべて入れる | 世界・minato | post あ×30い×5（35 字） | 行動の行は「- post：あ×30」、最近の投稿の行は本文 35 字すべて | B3-F, B4-T, B5-F, B6-F | 一時 DB（createTestDb、マイグレーション済み）。generationSeed で世界・エージェント・生成イベントを入れる | 一部 TC-NOUS62_DEV-32（行の数だけ） |  | TC-UT_MEM-004 行動の行は本文の先頭 30 字で切り、最近の投稿の行は本文をすべて入れる |  |
| TC-UT_MEM-005 | updateMemories | 正常系 | 境界値 | 入りきらない行は途中で切らずに捨てる（残る行はどれも本文の全体） | 世界・minato | 124 字の post を 5 回 | 「最近の投稿：」の後の行は 1 行以上あり、どれも本文の全体（途中で切った行がない） | B1-T, B2-T | 一時 DB（createTestDb、マイグレーション済み）。generationSeed で世界・エージェント・生成イベントを入れる | 一部 TC-NOUS62_DEV-32（400 字以内だけ） |  | TC-UT_MEM-005 入りきらない行は途中で切らずに捨てる（残る行はどれも本文の全体） |  |
| TC-UT_MEM-006 | updateMemories | 正常系 | 分岐網羅 | relationship_summary は回数が同じならフォロー中を先に、次にハンドルの順に並べる | haruka・zen・aki の投稿、minato は zen をフォロー中 | minato が 3 体の投稿にいいね 1 回ずつ | @zen：フォロー中、いいね 1 回／@aki：いいね 1 回／@haruka：いいね 1 回 | B7-T, B8-T | 一時 DB（createTestDb、マイグレーション済み）。generationSeed で世界・エージェント・生成イベントを入れる | なし（DEV は回数の違う 2 体だけ） |  | TC-UT_MEM-006 relationship_summary は回数が同じならフォロー中を先に、次にハンドルの順に並べる | 同数のときの並びは設計書に記載なし（「回数の多い順」だけ）。実装の値 |
| TC-UT_MEM-007 | updateMemories | 正常系 | 境界値 | relationship_summary は 6 体以上の相手がいても 5 体までにする | aaa〜fff の 6 体の投稿 | minato が 6 体の投稿にいいね 1 回ずつ | @aaa〜@eee の 5 行（fff は入らない） | B8-T | 一時 DB（createTestDb、マイグレーション済み）。generationSeed で世界・エージェント・生成イベントを入れる | なし |  | TC-UT_MEM-007 relationship_summary は 6 体以上の相手がいても 5 体までにする |  |
| TC-UT_MEM-008 | updateMemories | 正常系 | 同値分割 | 自分の投稿への自分の返信は、相手ごとの集計に数えない | minato の投稿 | minato が自分の投稿に返信 | relationship_summary は空文字 | B10-T | 一時 DB（createTestDb、マイグレーション済み）。generationSeed で世界・エージェント・生成イベントを入れる | なし |  | TC-UT_MEM-008 自分の投稿への自分の返信は、相手ごとの集計に数えない |  |
| TC-UT_MEM-009 | updateMemories | 正常系 | 境界値 | conversation_summary は 4 つ以上のスレッドに加わっていても、新しい 3 つまで | haruka の起点 4 つ | minato が 4 つに順に返信 | conversation_summary は四つ目・三つ目・二つ目の 3 行 | B2-T, B10-T | 一時 DB（createTestDb、マイグレーション済み）。generationSeed で世界・エージェント・生成イベントを入れる | なし（DEV は 1 スレッドだけ） |  | TC-UT_MEM-009 conversation_summary は 4 つ以上のスレッドに加わっていても、新しい 3 つまで |  |
| TC-UT_MEM-010 | updateMemories | 正常系 | 同値分割 | 自分が加わっていない、他の住人どうしのスレッドは conversation_summary に入れない | haruka の起点に zen が返信したスレッド、haruka の別の起点 | minato が別の起点に返信 | conversation_summary は minato が加わったスレッドの 1 行だけ | B10-T | 一時 DB（createTestDb、マイグレーション済み）。generationSeed で世界・エージェント・生成イベントを入れる | なし |  | TC-UT_MEM-010 自分が加わっていない、他の住人どうしのスレッドは conversation_summary に入れない |  |
| TC-UT_MEM-011 | updateMemories | 正常系 | 同値分割 | 起点が非表示にされたスレッドでは、非表示の起点の本文を conversation_summary に入れない | haruka の起点に zen が返信し、起点を非表示にする | minato が zen の返信に返信 | conversation_summary に、非表示の起点の本文が入らない | B10-T | 一時 DB（createTestDb、マイグレーション済み）。generationSeed で世界・エージェント・生成イベントを入れる | なし | 疑い 1：起点が非表示でも、公開の返信が 2 件あるスレッドは選ばれ、起点の本文（r.body）が visibility を見ずに入る | TC-UT_MEM-011 起点が非表示にされたスレッドでは、非表示の起点の本文を conversation_summary に入れない | 設計書に記載なし。NOUS-62 の実装のコメント（非表示の投稿を記憶に入れない）による |
| TC-UT_MEM-012 | updateMemories | 正常系 | 同値分割 | interest_profile は行動の後も変えない | minato の interest_profile（2026-10-01 の内容） | minato が post | interest_profile の内容と updated_at は変わらない | B9-F | 一時 DB（createTestDb、マイグレーション済み）。generationSeed で世界・エージェント・生成イベントを入れる | なし |  | TC-UT_MEM-012 interest_profile は行動の後も変えない |  |
| TC-UT_MEM-013 | updateMemories | 正常系 | 分岐網羅 | like では recent_posts・relationship_summary を作り、conversation_summary は作らない | haruka の投稿 | minato が like | recent_posts に「- like：@haruka」、relationship_summary は「@haruka：いいね 1 回」、conversation_summary は作らない | B6-T, B9-F, B10-F, B4-F, B5-F | 一時 DB（createTestDb、マイグレーション済み）。generationSeed で世界・エージェント・生成イベントを入れる | 一部 TC-NOUS62_DEV-35（post の場合だけ） |  | TC-UT_MEM-013 like では recent_posts・relationship_summary を作り、conversation_summary は作らない |  |
| TC-UT_MEM-014 | clip | 正常系 | 境界値 | clip はちょうど n 字ならそのまま、n＋1 字なら n 字に切る | なし | clip(あいう, 3)、clip(あいうえ, 3) | あいう、あいう | B3-T, B3-F | なし | 一部 TC-NOUS62_DEV-36（n より短い・長い場合） |  | TC-UT_MEM-014 clip はちょうど n 字ならそのまま、n＋1 字なら n 字に切る |  |

## 3. 確認事項・バグの疑い

- 疑い 1：buildConversationSummary は、スレッドの件数を公開の投稿だけで数えるが、起点の本文（r.body）は visibility を見ずに読む。そのため、起点が非表示にされたスレッドでも、公開の返信が 2 件あれば、非表示の起点の本文の先頭 40 字が conversation_summary に入る（TC-UT_MEM-011）。NOUS-62 の実装のコメントの「非表示の投稿を記憶に入れない」と食い違う。
- 確認事項 1：conversation_summary には他の住人の投稿（起点）の先頭 40 字が入り、記憶は system に入る。11章（NFR-S-012）の「他の住人の投稿は user の <timeline> の中だけに置く」と、8章の conversation_summary の内容が両立していない。NOUS-102 の確認事項（promptBuilder）と同じ件。
- 確認事項 2：relationship_summary の同数のときの並び（フォロー中が先、次にハンドルの順）は設計書に記載がなく、実装の値を期待値にした（TC-UT_MEM-006）。
