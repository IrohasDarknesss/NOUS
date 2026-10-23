# 単体テスト観点表：入力に使う文脈の読み込み（generation/contextLoader.ts）

| 項目 | 内容 |
|---|---|
| 関連チケット | NOUS-102 |
| 作成者 | Takaya Ishikawa（開発担当） |
| 作成日 | 2026-10-23 |
| 対象 | apps/server/src/generation/contextLoader.ts |
| 言語 / フレームワーク | TypeScript / Vitest 2.1.9（environment: node） |
| テストファイル | apps/server/src/generation/contextLoader.test.ts（実装時、NOUS-61）, apps/server/src/generation/contextLoader.ut.test.ts（単体テストで追加） |
| 外部依存 | SQLite（drizzle。テストは createTestDb の一時 DB をテストごとに作り直す） |
| 入力にした設計書 | BE 詳細設計 generation 4章 loadContext・selectRefPosts、3章のクエリ, 行動生成とプロンプトの設計 5.2 |

このファイルは `docs/test/unit/_build/build_matrix.py` で JSON から作る。直すときは JSON を直して作り直す。

## 1. 分岐の一覧

| ID | 条件 | 場所 |
|---|---|---|
| B1 | !row（稼働中のエージェントが無い） | contextLoader.ts:87 |
| B2 | content && content.trim().length > 0（空でない記憶だけ） | contextLoader.ts:101 |
| B3 | row.action && row.action !== "none" | contextLoader.ts:121 |
| B4 | join === "followee" && me !== undefined（フォローで JOIN する） | contextLoader.ts:147 |
| B5 | exclude.length > 0（選んだ投稿を除く条件を足す） | contextLoader.ts:162 |
| B6 | picked.length < max && !ids().includes(row.postId) | contextLoader.ts:212 |
| B7 | picked.length < max（フォロー中の投稿を読む） | contextLoader.ts:216 |
| B8 | picked.length < max（世界全体の投稿を読む） | contextLoader.ts:219 |
| B9 | a.worldTimeSec - b.worldTimeSec \|\| …（同じ時刻なら投稿 ID の順） | contextLoader.ts:222 |
| B10 | refs.length === 0（いいねできる投稿を読まない） | contextLoader.ts:232 |
| B11 | r.agentId !== me && !liked.has(r.postId) | contextLoader.ts:249 |

## 2. ケースの一覧（19 件。うち新しく足したもの 10 件）

| ID | 対象 | 分類 | 技法 | 観点 | 前提 | 入力 | 期待結果 | 分岐 | モック | 既存テストとの対応 | バグの疑い | テスト名 | 備考 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| TC-NOUS61_DEV-41 | loadContext | 異常系 | 開発者テスト | 稼働中でないエージェントは AgentNotActiveError | 停止中のエージェント | 停止中のエージェント ID、存在しない ID | AgentNotActiveError | B1-T | 一時 DB（createTestDb） | 実装時のテスト（NOUS-61） |  | TC-NOUS61_DEV-41 稼働中でないエージェントは AgentNotActiveError |  |
| TC-NOUS61_DEV-42 | loadContext | 正常系 | 開発者テスト | 記憶を固定の順に並べ、空のものは除く | 記憶 3 件（会話・関心・空白だけの関係） | 自分の ID | interest_profile → conversation_summary の 2 件 | B1-F, B2-T, B2-F | 一時 DB（createTestDb） | 実装時のテスト（NOUS-61） |  | TC-NOUS61_DEV-42 記憶を固定の順に並べ、空のものは除く |  |
| TC-NOUS61_DEV-43 | loadContext | 正常系 | 開発者テスト | 直近 2 回の成功した行動を新しい順に読み、none と失敗は除く | post・like・失敗した follow・none・reply の生成イベント | 自分の ID | ['reply','like'] | B3-T | 一時 DB（createTestDb） | 実装時のテスト（NOUS-61） |  | TC-NOUS61_DEV-43 直近 2 回の成功した行動を新しい順に読み、none と失敗は除く |  |
| TC-NOUS61_DEV-44 | loadContext | 正常系 | 開発者テスト | 参照する投稿は自分の投稿・非表示・別の世界を含まず、古い順に P1 から番号を付ける | 自分の投稿、他人の公開 2 件・非表示 1 件、別の世界の投稿 | 自分の ID、max 12 | P1・P2 が他人の公開の 2 件（古い順） | B4-F, B5-F, B5-T, B6-T, B7-T, B8-T, B9-T, B10-F, B11-T | 一時 DB（createTestDb） | 実装時のテスト（NOUS-61） |  | TC-NOUS61_DEV-44 参照する投稿は自分の投稿・非表示・別の世界を含まず、古い順に P1 から番号を付ける |  |
| TC-NOUS61_DEV-45 | selectRefPosts | 正常系 | 開発者テスト | 自分への未返信の返信（3）→ フォロー中の投稿（5）→ 新しい投稿（残り）の優先で選ぶ | 自分への返信 4 件と返信済み 1 件、フォロー中の投稿 6 件、新しい投稿 3 件 | max 10 | 返信の新しい 3 件、フォロー中の新しい 5 件、新しい投稿の新しい 2 件。古い順・P1 から | B4-T, B5-T, B6-T, B7-T, B8-T, B9-T | 一時 DB（createTestDb） | 実装時のテスト（NOUS-61） |  | TC-NOUS61_DEV-45 自分への未返信の返信（3）→ フォロー中の投稿（5）→ 新しい投稿（残り）の優先で選ぶ |  |
| TC-NOUS61_DEV-46 | selectRefPosts | 正常系 | 開発者テスト | max_ref_posts を超えて選ばず、重複もしない | 自分への返信 1 件（フォロー中の住人から）、フォロー中の投稿 2 件 | max 2、max 12 | 2 件で重複なし、max 12 なら 3 件 | B7-T, B8-F | 一時 DB（createTestDb） | 実装時のテスト（NOUS-61） |  | TC-NOUS61_DEV-46 max_ref_posts を超えて選ばず、重複もしない |  |
| TC-NOUS61_DEV-47 | loadContext | 正常系 | 開発者テスト | いいねできる投稿は、参照する投稿のうちまだいいねしていないもの | 他人の投稿 2 件、うち 1 件にいいね済み | 自分の ID | いいねしていない 1 件だけ | B10-F, B11-T, B11-F | 一時 DB（createTestDb） | 実装時のテスト（NOUS-61） |  | TC-NOUS61_DEV-47 いいねできる投稿は、参照する投稿のうちまだいいねしていないもの |  |
| TC-NOUS61_DEV-48 | loadContext | 正常系 | 開発者テスト | フォローできる住人は、同じ世界の稼働中で、自分以外の、フォローしていない住人（登録順に 8 体まで） | フォロー中・解除済み・停止中・別の世界の住人と、ほか 9 体 | 自分の ID | 解除済みを先頭に 8 体。自分・フォロー中・停止中・別の世界を含まない |  | 一時 DB（createTestDb） | 実装時のテスト（NOUS-61） |  | TC-NOUS61_DEV-48 フォローできる住人は、同じ世界の稼働中で、自分以外の、フォローしていない住人（登録順に 8 体まで） |  |
| TC-NOUS61_DEV-49 | loadContext | 正常系 | 開発者テスト | フォロー中の住人は、継続中のフォローの相手だけ | 継続中 1 件、解除済み 1 件 | 自分の ID | 継続中の相手 1 体だけ |  | 一時 DB（createTestDb） | 実装時のテスト（NOUS-61） |  | TC-NOUS61_DEV-49 フォロー中の住人は、継続中のフォローの相手だけ |  |
| TC-UT_CTX-001 | loadContext | 異常系 | 同値分割 | 別の世界のエージェントとして読むと AgentNotActiveError（world_id の条件） | 別の世界の稼働中のエージェント | worldId は現在の世界、agentId は別の世界のエージェント | AgentNotActiveError | B1-T | 一時 DB（createTestDb） | 一部 TC-NOUS61_DEV-41（停止中と存在しない ID だけ） |  | TC-UT_CTX-001 別の世界のエージェントとして読むと AgentNotActiveError |  |
| TC-UT_CTX-002 | loadContext | 正常系 | 同値分割 | 直近の行動は、同じ世界の生成イベントだけを読む | 同じ世界の like、別の世界の follow | 自分の ID | recentActions は ['like'] | B1-F, B3-T | 一時 DB（createTestDb） | なし（DEV-43 は同じ世界だけ） |  | TC-UT_CTX-002 直近の行動は、同じ世界の生成イベントだけを読む |  |
| TC-UT_CTX-003 | selectRefPosts | 正常系 | 分岐網羅 | 自分の投稿への返信は、古くても世界全体の新しい投稿より先に選び、他人の投稿への返信は優先しない | 自分の投稿への返信（2）、他人の投稿への返信（4）、新しい投稿（5） | max 1 | 自分の投稿への返信の 1 件だけ | B6-T, B7-F, B8-F, B10-F | 一時 DB（createTestDb） | 一部 TC-NOUS61_DEV-45（他人の投稿への返信が無い） |  | TC-UT_CTX-003 自分の投稿への返信は、古くても世界全体の新しい投稿より先に選び、他人の投稿への返信は優先しない |  |
| TC-UT_CTX-004 | selectRefPosts | 異常系 | 同値分割 | 非表示の返信は、自分の投稿への返信でも選ばない | 自分の投稿への非表示の返信だけ | max 12 | [] | B5-F, B7-T, B8-T | 一時 DB（createTestDb） | 一部 TC-NOUS61_DEV-44（返信でない非表示の投稿だけ） |  | TC-UT_CTX-004 非表示の返信は、自分の投稿への返信でも選ばない |  |
| TC-UT_CTX-005 | selectRefPosts | 正常系 | 分岐網羅 | フォロー中の住人の投稿は、古くても世界全体の新しい投稿より先に選び、解除したフォローは優先しない | フォロー中の投稿（1）、解除した住人の投稿（2）、ほかの新しい投稿（3） | max 1、max 2 | max 1 は [フォロー中]、max 2 は [フォロー中, 新しい投稿] | B4-T, B5-T, B7-T, B8-T, B8-F | 一時 DB（createTestDb） | 一部 TC-NOUS61_DEV-45（解除したフォローが無い） |  | TC-UT_CTX-005 フォロー中の住人の投稿は、古くても世界全体の新しい投稿より先に選び、解除したフォローは優先しない |  |
| TC-UT_CTX-006 | selectRefPosts | 正常系 | 境界値 | max_ref_posts が 1（下限）のとき、自分への返信が 3 件あっても新しい 1 件だけを P1 にする | 自分の投稿への返信 3 件 | max 1 | [['P1', 最も新しい返信]] | B6-T, B7-F, B8-F | 一時 DB（createTestDb） | 一部 TC-NOUS61_DEV-46（max 2 だけ） |  | TC-UT_CTX-006 max_ref_posts が 1 のとき、自分への返信が 3 件あっても新しい 1 件だけを P1 にする | world_settings.max_ref_posts は 1〜30 |
| TC-UT_CTX-007 | selectRefPosts | 正常系 | 分岐網羅 | 世界内時間が同じ投稿は、投稿 ID の順に並べる | 他人の投稿 2 件（同じ世界内時間 5） | max 12 | 投稿 ID の昇順 | B9-F | 一時 DB（createTestDb） | なし |  | TC-UT_CTX-007 世界内時間が同じ投稿は、投稿 ID の順に並べる | 設計書は「世界内時間の古い順」まで。同じ時刻の順は記載なし（実装の値） |
| TC-UT_CTX-008 | loadContext | 正常系 | 境界値 | 投稿も住人も記憶もなければ、参照する投稿・いいねできる投稿・相手の一覧・記憶は空 | 自分だけの世界 | 自分の ID | refs・likeablePostIds・followTargets・followees・memories がすべて [] | B1-F, B7-T, B8-T, B10-T | 一時 DB（createTestDb） | なし |  | TC-UT_CTX-008 投稿も住人も記憶もなければ、参照する投稿・いいねできる投稿・相手の一覧・記憶は空 |  |
| TC-UT_CTX-009 | loadContext | 正常系 | 状態遷移 | 停止中の住人の公開中の投稿は参照する投稿に入り、停止中の住人へのフォローはフォロー中に残る | フォローした住人の投稿のあと、その住人を停止 | 自分の ID | refs にその投稿、followees にその住人、followTargets は [] | B4-T, B11-T | 一時 DB（createTestDb） | なし |  | TC-UT_CTX-009 停止中の住人の公開中の投稿は参照する投稿に入り、停止中の住人へのフォローはフォロー中に残る | 設計書 3章の条件（posts は visibility、follows は ended_world_sec）に書き手の状態は無い。実装の値。issues の確認事項 1 |
| TC-UT_CTX-010 | selectRefPosts | 正常系 | 同値分割 | 自分が返信済みの、自分の投稿への返信は、優先 1 には入らないが世界全体の新しい投稿として選べる | 自分の投稿、それへの他人の返信、その返信への自分の返信 | max 12 | [他人の返信] だけ | B5-F, B8-T | 一時 DB（createTestDb） | 一部 TC-NOUS61_DEV-45（返信済みのものが優先 1 に入らないことだけ） |  | TC-UT_CTX-010 自分の投稿への返信に自分が返信済みでも、その返信は世界全体の新しい投稿として選べる |  |

## 3. 確認事項・バグの疑い

- 確認事項 1：停止中の住人の公開中の投稿は参照する投稿に入り、停止中の住人へのフォローは「フォロー中の住人」に残る（TC-UT_CTX-009）。設計書 3章のクエリどおりだが、停止中の住人に返信・フォロー解除を選べてよいかは決まっていない。
- 分岐 B3 の偽：loadRecentActions の where で status = 'succeeded' かつ action <> 'none'（NULL も除かれる）に絞っているため、B3 が偽になる行は返らない。防御のための分岐で、テストでは通らない。
- 分岐 B6 の偽：各クエリに件数の上限（残りの件数）と、選んだ投稿を除く条件（exclude）を渡しているため、add の中で上限に達する・重複する行は返らない。防御のための分岐で、テストでは通らない。
- 分岐 B11：参照する投稿は自分の投稿を含まないため、r.agentId === me の側はテストでは通らない（いいね済みの側は TC-NOUS61_DEV-47 で通る）。
