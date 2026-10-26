# 単体テスト観点表：行動の反映（generation/actionApplier.ts）

| 項目 | 内容 |
|---|---|
| 関連チケット | NOUS-103 |
| 作成者 | Takaya Ishikawa（開発担当） |
| 作成日 | 2026-10-23 |
| 対象 | apps/server/src/generation/actionApplier.ts |
| 言語 / フレームワーク | TypeScript / Vitest 2.1.9（environment: node） |
| テストファイル | apps/server/src/generation/actionApplier.test.ts（実装時、NOUS-62）, apps/server/src/generation/actionApplier.ut.test.ts（単体テストで追加） |
| 外部依存 | 一時 DB（createTestDb）。前提のデータは generationSeed（seedWorld・seedAgent・seedEvent）, 時刻は引数の nowIso・usageDate（2026-10-22T09:00:00.000Z・2026-10-22）で固定。Clock は使わない, ID は newUlid（値そのものは確かめない） |
| 入力にした設計書 | 行動生成とプロンプトの設計 7章, BE 詳細設計 generation 3章（insertPost・insertLike・insertFollow／endFollow）・4章 applyAction・6章 DuplicateActionError |

このファイルは `docs/test/unit/_build/build_matrix.py` で JSON から作る。直すときは JSON を直して作り直す。

## 1. 分岐の一覧

| ID | 条件 | 場所 |
|---|---|---|
| B1 | reply：返信先の投稿がない（target === undefined） | actionApplier.ts:139 |
| B2 | reply：返信先が別の世界（target.world_id !== ctx.worldId） | actionApplier.ts:139 |
| B3 | countRepliedPost：返信先の作成日の日付が usageDate と違う | actionApplier.ts:78 |
| B4 | countRepliedPost：返信先への返信がすでにある | actionApplier.ts:86 |
| B5 | guardUnique：例外が UNIQUE・PRIMARY KEY の違反（DuplicateActionError にする） | actionApplier.ts:56・68 |
| B6 | uniqueViolation：message から制約の名前を取れない（?? String(code)） | actionApplier.ts:61 |
| B7 | unfollow：更新した継続中のフォローがない | actionApplier.ts:225 |
| B8 | switch：none | actionApplier.ts:102 |
| B9 | switch：post | actionApplier.ts:105 |
| B10 | switch：reply | actionApplier.ts:127 |
| B11 | switch：like | actionApplier.ts:174 |
| B12 | switch：follow | actionApplier.ts:193 |
| B13 | switch：unfollow | actionApplier.ts:211 |

## 2. ケースの一覧（20 件。うち新しく足したもの 12 件）

| ID | 対象 | 分類 | 技法 | 観点 | 前提 | 入力 | 期待結果 | 分岐 | モック | 既存テストとの対応 | バグの疑い | テスト名 | 備考 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| TC-NOUS62_DEV-21 | applyAction | 正常系 | 開発者テスト | post は reply_to=NULL・root=自分・depth=0 で 1 行入れる | 世界・minato・haruka | post「朝の港です」、世界内時間 100 | posts に 1 行（reply_to=NULL、root=自分、depth=0、public） | B9-T, B8-F, B10-F, B11-F, B12-F, B13-F | 一時 DB（createTestDb、マイグレーション済み）。generationSeed で世界・エージェント・生成イベントを入れる | 実装時のテスト（NOUS-62） |  | TC-NOUS62_DEV-21 post は reply_to=NULL・root=自分・depth=0 で 1 行入れる |  |
| TC-NOUS62_DEV-22 | applyAction | 正常系 | 開発者テスト | reply は対象の root と depth＋1 で入れ、今日の初めての返信なら replied_posts を加算する | minato の投稿（今日） | haruka が起点に返信、minato がその返信に返信、haruka が起点に 2 回目の返信 | root と depth＋1。replied_posts は 2（2 回目の返信は数えない） | B1-F, B2-F, B3-F, B4-F, B4-T, B10-T, B8-F, B9-F, B11-F, B12-F, B13-F | 一時 DB（createTestDb、マイグレーション済み）。generationSeed で世界・エージェント・生成イベントを入れる | 実装時のテスト（NOUS-62） |  | TC-NOUS62_DEV-22 reply は対象の root と depth＋1 で入れ、今日の初めての返信なら replied_posts を加算する |  |
| TC-NOUS62_DEV-23 | applyAction | 正常系 | 開発者テスト | 前の日の投稿への返信は replied_posts に数えない | 起点の created_at を 2026-10-21T09:00 に | haruka が起点に返信 | firstReplyToday=false、daily_metrics は 0 行 | B3-T | 一時 DB（createTestDb、マイグレーション済み）。generationSeed で世界・エージェント・生成イベントを入れる | 実装時のテスト（NOUS-62） |  | TC-NOUS62_DEV-23 前の日の投稿への返信は replied_posts に数えない |  |
| TC-NOUS62_DEV-24 | applyAction | 異常系 | 開発者テスト | like を入れ、同じ投稿への 2 回目は DuplicateActionError | minato の投稿 | haruka が同じ投稿に 2 回いいね | 1 回目は入り、2 回目は DuplicateActionError、likes は 1 行のまま | B5-T, B11-T, B8-F, B9-F, B10-F, B12-F, B13-F | 一時 DB（createTestDb、マイグレーション済み）。generationSeed で世界・エージェント・生成イベントを入れる | 実装時のテスト（NOUS-62） |  | TC-NOUS62_DEV-24 like を入れ、同じ投稿への 2 回目は DuplicateActionError |  |
| TC-NOUS62_DEV-25 | applyAction | 正常系 | 開発者テスト | follow → unfollow で開始と解除の時刻・イベントが残る | 世界・minato・haruka | follow（100）→ unfollow（200） | follows の開始・解除の時刻とイベントが残る | B7-F, B12-T, B13-T, B8-F, B9-F, B10-F, B11-F | 一時 DB（createTestDb、マイグレーション済み）。generationSeed で世界・エージェント・生成イベントを入れる | 実装時のテスト（NOUS-62） |  | TC-NOUS62_DEV-25 follow → unfollow で開始と解除の時刻・イベントが残る |  |
| TC-NOUS62_DEV-26 | applyAction | 異常系 | 開発者テスト | 継続中のフォローの 2 重は DuplicateActionError、フォローのない解除も DuplicateActionError | minato が haruka をフォロー中 | 同じ follow をもう一度、haruka から minato の unfollow | どちらも DuplicateActionError | B5-T, B7-T | 一時 DB（createTestDb、マイグレーション済み）。generationSeed で世界・エージェント・生成イベントを入れる | 実装時のテスト（NOUS-62） |  | TC-NOUS62_DEV-26 継続中のフォローの 2 重は DuplicateActionError、フォローのない解除も DuplicateActionError |  |
| TC-NOUS62_DEV-27 | applyAction | 異常系 | 開発者テスト | 同じ生成イベントでの 2 回目の投稿は DuplicateActionError（generation_event_id の UNIQUE） | 同じ生成イベント | post を 2 回 | 2 回目は DuplicateActionError、errorDetail に generation_event_id | B5-T, B6-F | 一時 DB（createTestDb、マイグレーション済み）。generationSeed で世界・エージェント・生成イベントを入れる | 実装時のテスト（NOUS-62） |  | TC-NOUS62_DEV-27 同じ生成イベントでの 2 回目の投稿は DuplicateActionError（generation_event_id の UNIQUE） |  |
| TC-NOUS62_DEV-28 | applyAction | 正常系 | 開発者テスト | none は何も入れない | 世界・minato | none | { action: none }、posts・likes・follows は 0 行 | B8-T, B9-F, B10-F, B11-F, B12-F, B13-F | 一時 DB（createTestDb、マイグレーション済み）。generationSeed で世界・エージェント・生成イベントを入れる | 実装時のテスト（NOUS-62） |  | TC-NOUS62_DEV-28 none は何も入れない |  |
| TC-UT_APL-001 | applyAction | 異常系 | 分岐網羅 | 返信先の投稿がなければ、DuplicateActionError でないエラーで止め、何も入れない | 世界・minato・haruka | reply、targetPostId = 存在しない ID | Error「返信先の投稿が同じ世界にありません」（DuplicateActionError ではない）。posts は 0 行 | B1-T | 一時 DB（createTestDb、マイグレーション済み）。generationSeed で世界・エージェント・生成イベントを入れる | なし |  | TC-UT_APL-001 返信先の投稿がなければ、DuplicateActionError でないエラーで止め、何も入れない |  |
| TC-UT_APL-002 | applyAction | 異常系 | 分岐網羅 | 返信先が別の世界の投稿なら、DuplicateActionError でないエラーで止め、何も入れない | アーカイブ済みの世界に stranger の投稿 | minato が今の世界から、その投稿に reply | Error「返信先の投稿が同じ世界にありません」（DuplicateActionError ではない）。minato の posts は 0 行 | B1-F, B2-T | 一時 DB（createTestDb、マイグレーション済み）。generationSeed で世界・エージェント・生成イベントを入れる。アーカイブ済みの世界はテストの中で insert する（ux_worlds_current のため） | なし |  | TC-UT_APL-002 返信先が別の世界の投稿なら、DuplicateActionError でないエラーで止め、何も入れない |  |
| TC-UT_APL-003 | applyAction | 正常系 | 分岐網羅 | daily_metrics に今日の行があれば、replied_posts だけを 1 増やし、他の列は変えない | daily_metrics（今日）に runs 7・posts 5・replies 3・replied_posts 2・nones 1 の行、haruka の投稿（今日） | minato が返信 | replied_posts だけ 3 になり、他の列は変わらない | B3-F, B4-F, B10-T, B8-F, B9-F, B11-F, B12-F, B13-F | 一時 DB（createTestDb、マイグレーション済み）。generationSeed で世界・エージェント・生成イベントを入れる | 一部 TC-NOUS62_DEV-22（行がないところから作る場合だけ） |  | TC-UT_APL-003 daily_metrics に今日の行があれば、replied_posts だけを 1 増やし、他の列は変えない |  |
| TC-UT_APL-004 | applyAction | 正常系 | 同値分割 | 自分の投稿への返信も、今日の初めての返信なら replied_posts に数える | minato の投稿（今日） | minato が自分の投稿に返信 | depth=1、firstReplyToday=true、replied_posts=1 | B3-F, B4-F | 一時 DB（createTestDb、マイグレーション済み）。generationSeed で世界・エージェント・生成イベントを入れる | なし（DEV は他の住人の投稿への返信だけ） |  | TC-UT_APL-004 自分の投稿への返信も、今日の初めての返信なら replied_posts に数える | 7章は「対象が今日の投稿で返信が初めてなら」で、返信した人を問わない |
| TC-UT_APL-005 | applyAction | 正常系 | 境界値 | 返信先の作成日時がその日の 00:00:00.000 なら今日の投稿として数える | haruka の投稿の created_at を 2026-10-22T00:00:00.000Z に | minato が返信（usageDate 2026-10-22） | firstReplyToday=true、replied_posts=1 | B3-F | 一時 DB（createTestDb、マイグレーション済み）。generationSeed で世界・エージェント・生成イベントを入れる | なし（DEV は 09:00 だけ） |  | TC-UT_APL-005 返信先の作成日時がその日の 00:00:00.000 なら今日の投稿として数える |  |
| TC-UT_APL-006 | applyAction | 正常系 | 境界値 | 返信先の作成日時が前の日の 23:59:59.999 なら数えない | haruka の投稿の created_at を 2026-10-21T23:59:59.999Z に | minato が返信（usageDate 2026-10-22） | firstReplyToday=false、daily_metrics は 0 行 | B3-T | 一時 DB（createTestDb、マイグレーション済み）。generationSeed で世界・エージェント・生成イベントを入れる | 一部 TC-NOUS62_DEV-23（前の日の 09:00） |  | TC-UT_APL-006 返信先の作成日時が前の日の 23:59:59.999 なら数えない |  |
| TC-UT_APL-007 | applyAction | 正常系 | 状態遷移 | 解除の後にフォローし直すと、新しい行として入り、継続中は 1 行だけ | minato が haruka を follow（100）→ unfollow（200） | もう一度 follow（300） | follows は 2 行、継続中は世界内時間 300・今回のイベントの 1 行だけ | B12-T, B8-F, B9-F, B10-F, B11-F, B13-F | 一時 DB（createTestDb、マイグレーション済み）。generationSeed で世界・エージェント・生成イベントを入れる | なし（DEV は 1 回のフォローと解除まで） |  | TC-UT_APL-007 解除の後にフォローし直すと、新しい行として入り、継続中は 1 行だけ |  |
| TC-UT_APL-008 | applyAction | 異常系 | 状態遷移 | 解除済みのフォローしかない相手の解除は DuplicateActionError（unfollow_without_follow） | minato が haruka を follow（100）→ unfollow（200） | もう一度 unfollow（300） | DuplicateActionError、constraint=unfollow_without_follow、errorDetail=duplicate_action unfollow_without_follow。解除の行は 200 のまま | B7-T, B13-T, B8-F, B9-F, B10-F, B11-F, B12-F | 一時 DB（createTestDb、マイグレーション済み）。generationSeed で世界・エージェント・生成イベントを入れる | 一部 TC-NOUS62_DEV-26（フォローしたことのない相手、型だけ） |  | TC-UT_APL-008 解除済みのフォローしかない相手の解除は DuplicateActionError（unfollow_without_follow） |  |
| TC-UT_APL-009 | applyAction | 異常系 | エラー処理 | UNIQUE 以外の制約の違反（自分へのフォロー）は DuplicateActionError にせず、そのまま投げ直す | 世界・minato | minato が minato を follow（follows の CHECK follower_id <> followee_id に違反） | 例外を投げ、DuplicateActionError ではない。follows は 0 行 | B5-F, B12-T, B8-F, B9-F, B10-F, B11-F, B13-F | 一時 DB（createTestDb、マイグレーション済み）。generationSeed で世界・エージェント・生成イベントを入れる | なし |  | TC-UT_APL-009 UNIQUE 以外の制約の違反（自分へのフォロー）は DuplicateActionError にせず、そのまま投げ直す | 検証（validateAction）の後には起きない組み合わせを、guardUnique の投げ直しを確かめるために直接入れる |
| TC-UT_APL-010 | applyAction | 異常系 | エラー処理 | いいねの 2 重の errorDetail に、違反した likes の列の名前が入る | haruka が minato の投稿にいいね済み | haruka が同じ投稿にいいね | DuplicateActionError、errorDetail が duplicate_action で始まり likes.agent_id と likes.post_id を含む | B5-T, B6-F, B11-T, B8-F, B9-F, B10-F, B12-F, B13-F | 一時 DB（createTestDb、マイグレーション済み）。generationSeed で世界・エージェント・生成イベントを入れる | 一部 TC-NOUS62_DEV-24（型だけ） |  | TC-UT_APL-010 いいねの 2 重の errorDetail に、違反した likes の列の名前が入る |  |
| TC-UT_APL-011 | applyAction | 正常系 | 同値分割 | like は世界内時間・生成イベント・作成日時を残し、戻り値の ID と行が一致する | minato の投稿 | haruka が like、世界内時間 150 | 戻り値の likeId が行と一致。world_id・world_time_sec=150・created_at・generation_event_id が入る | B11-T, B8-F, B9-F, B10-F, B12-F, B13-F | 一時 DB（createTestDb、マイグレーション済み）。generationSeed で世界・エージェント・生成イベントを入れる | 一部 TC-NOUS62_DEV-24（件数だけ） |  | TC-UT_APL-011 like は世界内時間・生成イベント・作成日時を残し、戻り値の ID と行が一致する |  |
| TC-UT_APL-012 | applyAction | 正常系 | 同値分割 | follow は開始の世界内時間と生成イベントを残し、解除の列は空のまま | 世界・minato・haruka | minato が haruka を follow、世界内時間 160 | 戻り値の followId が行と一致。started_world_sec=160・start_event_id、ended_world_sec と end_event_id は NULL | B12-T, B8-F, B9-F, B10-F, B11-F, B13-F | 一時 DB（createTestDb、マイグレーション済み）。generationSeed で世界・エージェント・生成イベントを入れる | 一部 TC-NOUS62_DEV-25（解除の後の行だけ） |  | TC-UT_APL-012 follow は開始の世界内時間と生成イベントを残し、解除の列は空のまま |  |

## 3. 確認事項・バグの疑い

- 確認事項 1：B6-T（制約の名前を message から取れない場合）は、better-sqlite3 の UNIQUE の違反の message がいつも「UNIQUE constraint failed: …」になるため、DB を使うテストでは通せない。uniqueViolation は公開されていないので、単体テストでは扱わない。
- 確認事項 2：B8〜B13 は switch の振り分けで、偽はほかの case を通るケースで当たる（分岐の列に補っている）。
- 確認事項 3：7章の none の反映（daily_metrics.nones の加算）と、replied_posts 以外の加算は、commitAction（opportunityRunner、NOUS-104 の対象）で行う。applyAction の単体テストでは見ない。
