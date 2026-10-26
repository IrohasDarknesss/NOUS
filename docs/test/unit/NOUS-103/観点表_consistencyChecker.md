# 単体テスト観点表：記憶との矛盾の検査 C01〜C04（generation/consistencyChecker.ts）

| 項目 | 内容 |
|---|---|
| 関連チケット | NOUS-103 |
| 作成者 | Takaya Ishikawa（開発担当） |
| 作成日 | 2026-10-23 |
| 対象 | apps/server/src/generation/consistencyChecker.ts |
| 言語 / フレームワーク | TypeScript / Vitest 2.1.9（environment: node） |
| テストファイル | apps/server/src/generation/consistencyChecker.test.ts（実装時、NOUS-62）, apps/server/src/generation/consistencyChecker.ut.test.ts（単体テストで追加） |
| 外部依存 | 一時 DB（createTestDb）。前提のデータは generationSeed と applyAction（commitAction と同じ順で、反映してから検査する）, config はテストの中で config/generation.json と同じ表を渡す, 巡の番号は seedEvent の cycleNo、世界内時間は巡×10 秒 |
| 入力にした設計書 | 行動生成とプロンプトの設計 9章, BE 詳細設計 generation 4章 checkConsistency, config/generation.json（firstPersonRules） |

このファイルは `docs/test/unit/_build/build_matrix.py` で JSON から作る。直すときは JSON を直して作り直す。

## 1. 分岐の一覧

| ID | 条件 | 場所 |
|---|---|---|
| B1 | C01：action が reply でない | consistencyChecker.ts:37 |
| B2 | C01：返信の相手を自分が解除した行がない（row === undefined） | consistencyChecker.ts:49 |
| B3 | C01：今の巡 − 解除した巡 > 3 | consistencyChecker.ts:49 |
| B4 | C02：文が 20 字未満 | consistencyChecker.ts:64 |
| B5 | C02：同じ文を含む過去の自分の投稿がある | consistencyChecker.ts:73 |
| B6 | C03：性格の記述に、規則のキーワードがない | consistencyChecker.ts:85 |
| B7 | C03：合わない一人称が本文にある | consistencyChecker.ts:89 |
| B8 | C04：本文に @ハンドルがない | consistencyChecker.ts:99 |
| B9 | C04：世界にいないハンドルがある | consistencyChecker.ts:106 |
| B10 | checkConsistency：action が post か reply | consistencyChecker.ts:119 |

## 2. ケースの一覧（28 件。うち新しく足したもの 20 件）

| ID | 対象 | 分類 | 技法 | 観点 | 前提 | 入力 | 期待結果 | 分岐 | モック | 既存テストとの対応 | バグの疑い | テスト名 | 備考 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| TC-NOUS62_DEV-41 | checkConsistency | 正常系 | 開発者テスト | 問題のない投稿は空の配列 | 世界・minato・haruka | post「今日は晴れています。」 | 空の配列 | B1-T, B4-T, B6-T, B8-T, B10-T | 一時 DB（createTestDb、マイグレーション済み）。generationSeed で世界・エージェント・生成イベントを入れる | 実装時のテスト（NOUS-62） |  | TC-NOUS62_DEV-41 問題のない投稿は空の配列 |  |
| TC-NOUS62_DEV-42 | checkConsistency | 正常系 | 開発者テスト | C01：解除から 3 巡以内の返信は候補、4 巡後は候補にしない | haruka の投稿、minato が 1 巡目に follow・2 巡目に unfollow | 5 巡目と 6 巡目に reply | 5 巡目は C01（@haruka を含む）、6 巡目は空 | B1-F, B2-F, B3-F, B3-T | 一時 DB（createTestDb、マイグレーション済み）。generationSeed で世界・エージェント・生成イベントを入れる | 実装時のテスト（NOUS-62） |  | TC-NOUS62_DEV-42 C01：解除から 3 巡以内の返信は候補、4 巡後は候補にしない |  |
| TC-NOUS62_DEV-43 | checkConsistency | 正常系 | 開発者テスト | C02：過去の自分の投稿と同じ 20 字以上の文は候補、今回の投稿自身とは比べない | minato の過去の投稿（24 字の文） | 同じ文を含む post、短い文の post を 2 回 | C02 が 1 件、20 字未満の一致は空 | B4-F, B4-T, B5-T, B5-F | 一時 DB（createTestDb、マイグレーション済み）。generationSeed で世界・エージェント・生成イベントを入れる | 実装時のテスト（NOUS-62） |  | TC-NOUS62_DEV-43 C02：過去の自分の投稿と同じ 20 字以上の文は候補、今回の投稿自身とは比べない |  |
| TC-NOUS62_DEV-44 | checkConsistency | 正常系 | 開発者テスト | C02：他のエージェントの投稿との一致は数えない | haruka の投稿（同じ文） | minato が同じ文を post | 空の配列 | B5-F | 一時 DB（createTestDb、マイグレーション済み）。generationSeed で世界・エージェント・生成イベントを入れる | 実装時のテスト（NOUS-62） |  | TC-NOUS62_DEV-44 C02：他のエージェントの投稿との一致は数えない |  |
| TC-NOUS62_DEV-45 | checkConsistency | 正常系 | 開発者テスト | C03：性格に「丁寧語」とあり本文に「俺」があれば候補、キーワードのない人格は検査しない | 性格「丁寧語で話す、几帳面」と「明るい」 | 「俺は今日も走ったぜ。」 | 前者は C03（俺を含む）、後者は空 | B6-F, B6-T, B7-T | 一時 DB（createTestDb、マイグレーション済み）。generationSeed で世界・エージェント・生成イベントを入れる | 実装時のテスト（NOUS-62） |  | TC-NOUS62_DEV-45 C03：性格に「丁寧語」とあり本文に「俺」があれば候補、キーワードのない人格は検査しない |  |
| TC-NOUS62_DEV-46 | checkConsistency | 正常系 | 開発者テスト | C04：世界にいない @ハンドルは候補、いる住人への言及は候補にしない | 世界に haruka がいる | 「@haruka さんと @nobody_here さんに聞きたい。」 | C04（@nobody_here だけ） | B8-F, B9-T | 一時 DB（createTestDb、マイグレーション済み）。generationSeed で世界・エージェント・生成イベントを入れる | 実装時のテスト（NOUS-62） |  | TC-NOUS62_DEV-46 C04：世界にいない @ハンドルは候補、いる住人への言及は候補にしない |  |
| TC-NOUS62_DEV-47 | checkConsistency | 正常系 | 開発者テスト | like・follow などの本文のない行動は C02〜C04 を見ない | haruka の投稿 | minato が like | 空の配列 | B1-T, B10-F | 一時 DB（createTestDb、マイグレーション済み）。generationSeed で世界・エージェント・生成イベントを入れる | 実装時のテスト（NOUS-62） |  | TC-NOUS62_DEV-47 like・follow などの本文のない行動は C02〜C04 を見ない |  |
| TC-NOUS62_DEV-48 | splitSentences | 正常系 | 開発者テスト | splitSentences は句点と改行で分ける | なし | 一。二！三？\n四 | [一。, 二！, 三？, 四] |  | なし | 実装時のテスト（NOUS-62） |  | TC-NOUS62_DEV-48 splitSentences は句点と改行で分ける |  |
| TC-UT_CON-001 | checkConsistency | 正常系 | 境界値 | C01：解除と同じ巡（差 0）の返信は候補にする | haruka の投稿、minato が 1 巡目に follow・3 巡目に unfollow | 3 巡目に reply | C01（巡の差 0） | B1-F, B2-F, B3-F | 一時 DB（createTestDb、マイグレーション済み）。generationSeed で世界・エージェント・生成イベントを入れる | 一部 TC-NOUS62_DEV-42（差 3 と 4 だけ） |  | TC-UT_CON-001 C01：解除と同じ巡（差 0）の返信は候補にする |  |
| TC-UT_CON-002 | checkConsistency | 正常系 | 分岐網羅 | C01：フォローしたことのない相手への返信は候補にしない | haruka の投稿、フォローしたことはない | 2 巡目に reply | 空の配列 | B1-F, B2-T | 一時 DB（createTestDb、マイグレーション済み）。generationSeed で世界・エージェント・生成イベントを入れる | なし |  | TC-UT_CON-002 C01：フォローしたことのない相手への返信は候補にしない |  |
| TC-UT_CON-003 | checkConsistency | 正常系 | 同値分割 | C01：フォローを続けている相手への返信は候補にしない | haruka の投稿、minato が 1 巡目に follow（継続中） | 2 巡目に reply | 空の配列 | B2-T | 一時 DB（createTestDb、マイグレーション済み）。generationSeed で世界・エージェント・生成イベントを入れる | なし |  | TC-UT_CON-003 C01：フォローを続けている相手への返信は候補にしない |  |
| TC-UT_CON-004 | checkConsistency | 正常系 | 同値分割 | C01：2 回解除していれば、新しいほうの解除の巡から数える | minato が haruka を 1 巡目に follow・unfollow、2 巡目に follow・5 巡目に unfollow | 8 巡目に reply | C01（detail に「5 巡目」）。古い解除（1 巡目）から数えると 7 巡で候補にならない | B3-F | 一時 DB（createTestDb、マイグレーション済み）。generationSeed で世界・エージェント・生成イベントを入れる | なし |  | TC-UT_CON-004 C01：2 回解除していれば、新しいほうの解除の巡から数える |  |
| TC-UT_CON-005 | checkConsistency | 正常系 | 境界値 | C02：ちょうど 20 字の文が過去の自分の投稿と一致すれば候補にする | minato の過去の投稿「あ×19。」（20 字） | post「前置きです。あ×19。」 | C02 が 1 件（detail に文を含む） | B4-F, B5-T | 一時 DB（createTestDb、マイグレーション済み）。generationSeed で世界・エージェント・生成イベントを入れる | 一部 TC-NOUS62_DEV-43（24 字の文） |  | TC-UT_CON-005 C02：ちょうど 20 字の文が過去の自分の投稿と一致すれば候補にする |  |
| TC-UT_CON-006 | checkConsistency | 正常系 | 境界値 | C02：19 字の文の一致は候補にしない | minato の過去の投稿「あ×18。」（19 字） | post「前置きです。あ×18。」 | 空の配列 | B4-T | 一時 DB（createTestDb、マイグレーション済み）。generationSeed で世界・エージェント・生成イベントを入れる | 一部 TC-NOUS62_DEV-43（5 字の文） |  | TC-UT_CON-006 C02：19 字の文の一致は候補にしない |  |
| TC-UT_CON-007 | checkConsistency | 正常系 | 同値分割 | C02：同じ文が本文に 2 回あっても候補は 1 件 | minato の過去の投稿（22 字の文） | 同じ文を 2 回つなげた post | C02 が 1 件 | B5-T | 一時 DB（createTestDb、マイグレーション済み）。generationSeed で世界・エージェント・生成イベントを入れる | なし |  | TC-UT_CON-007 C02：同じ文が本文に 2 回あっても候補は 1 件 |  |
| TC-UT_CON-008 | checkConsistency | 正常系 | 同値分割 | C02：2 つの文がそれぞれ過去の投稿と一致すれば候補は 2 件 | minato の過去の投稿 2 件（別の文） | 2 つの文をつなげた post | C02 が 2 件 | B5-T | 一時 DB（createTestDb、マイグレーション済み）。generationSeed で世界・エージェント・生成イベントを入れる | なし |  | TC-UT_CON-008 C02：2 つの文がそれぞれ過去の投稿と一致すれば候補は 2 件 |  |
| TC-UT_CON-009 | checkConsistency | 正常系 | 同値分割 | C03：性格に「です・ます」とあり、本文に「あたし」があれば候補にする | 性格「です・ます調で話す」 | post「あたしは元気です。」 | C03（detail に「です・ます」） | B6-F, B7-T | 一時 DB（createTestDb、マイグレーション済み）。generationSeed で世界・エージェント・生成イベントを入れる | 一部 TC-NOUS62_DEV-45（丁寧語と俺だけ） |  | TC-UT_CON-009 C03：性格に「です・ます」とあり、本文に「あたし」があれば候補にする |  |
| TC-UT_CON-010 | checkConsistency | 正常系 | 同値分割 | C03：性格に「無口」とあり、本文に「わたくし」があれば候補にする | 性格「無口な職人」 | post「わたくしが参ります。」 | C03 | B6-F, B7-T | 一時 DB（createTestDb、マイグレーション済み）。generationSeed で世界・エージェント・生成イベントを入れる | なし |  | TC-UT_CON-010 C03：性格に「無口」とあり、本文に「わたくし」があれば候補にする |  |
| TC-UT_CON-011 | checkConsistency | 正常系 | 分岐網羅 | C03：2 つの規則のキーワードに当たれば、規則ごとに 1 件ずつ候補にする | 性格「丁寧語を使うが無口」 | post「俺はわたくしとは言わない。」 | C03 が 2 件（規則ごと） | B6-F, B7-T | 一時 DB（createTestDb、マイグレーション済み）。generationSeed で世界・エージェント・生成イベントを入れる | なし |  | TC-UT_CON-011 C03：2 つの規則のキーワードに当たれば、規則ごとに 1 件ずつ候補にする |  |
| TC-UT_CON-012 | checkConsistency | 正常系 | 同値分割 | C03：合わない一人称が本文に複数あれば、1 件にまとめて並べる | 性格「丁寧語で話す」 | post「俺もオレも走る。」 | [{ C03, 性格に「丁寧語」とあるが、本文に「俺」「オレ」がある }] | B7-T | 一時 DB（createTestDb、マイグレーション済み）。generationSeed で世界・エージェント・生成イベントを入れる | なし |  | TC-UT_CON-012 C03：合わない一人称が本文に複数あれば、1 件にまとめて並べる |  |
| TC-UT_CON-013 | checkConsistency | 正常系 | 同値分割 | C03：「そのうち」も表の「うち」に当たる（表のとおり候補にする） | 性格「丁寧語で話す」 | post「そのうち行きます。」 | C03（detail に「うち」） | B7-T | 一時 DB（createTestDb、マイグレーション済み）。generationSeed で世界・エージェント・生成イベントを入れる | なし |  | TC-UT_CON-013 C03：「そのうち」も表の「うち」に当たる（表のとおり候補にする） | 確認事項 4 を参照 |
| TC-UT_CON-014 | checkConsistency | 正常系 | 同値分割 | C04：停止中でも同じ世界にいる住人への言及は候補にしない | 同じ世界に停止中の sleepy | post「@sleepy さんは元気かな。」 | 空の配列 | B8-F, B9-F | 一時 DB（createTestDb、マイグレーション済み）。generationSeed で世界・エージェント・生成イベントを入れる | なし |  | TC-UT_CON-014 C04：停止中でも同じ世界にいる住人への言及は候補にしない | 9章「生成の時点の同じ世界のエージェント」に停止中を含むと読んだ |
| TC-UT_CON-015 | checkConsistency | 正常系 | 同値分割 | C04：別の世界にだけいる住人への言及は候補にする | アーカイブ済みの世界にだけ faraway | post「@faraway さんに会いたい。」 | [{ C04, 世界にいない住人への言及：@faraway }] | B9-T | 一時 DB（createTestDb、マイグレーション済み）。generationSeed で世界・エージェント・生成イベントを入れる。アーカイブ済みの世界はテストの中で insert する（ux_worlds_current のため） | なし |  | TC-UT_CON-015 C04：別の世界にだけいる住人への言及は候補にする |  |
| TC-UT_CON-016 | checkConsistency | 正常系 | 同値分割 | C04：同じハンドルは 1 回だけ、いない住人が複数なら「、」でつなぐ | 世界に ghost1・ghost2 はいない | post「@ghost1 と @ghost2 と @ghost1 の話。」 | [{ C04, 世界にいない住人への言及：@ghost1、@ghost2 }] | B9-T | 一時 DB（createTestDb、マイグレーション済み）。generationSeed で世界・エージェント・生成イベントを入れる | 一部 TC-NOUS62_DEV-46（1 体だけ） |  | TC-UT_CON-016 C04：同じハンドルは 1 回だけ、いない住人が複数なら「、」でつなぐ |  |
| TC-UT_CON-017 | checkConsistency | 正常系 | 分岐網羅 | reply で C01〜C04 がそろえば、C01・C02・C03・C04 の順に返す | 性格「丁寧語で話す」の minato の過去の投稿、haruka の投稿、minato が 1 巡目に follow・2 巡目に unfollow | 3 巡目に、過去と同じ文・俺・@ghost_x を含む reply | C01・C02・C03・C04 の順の 4 件 | B1-F, B3-F, B5-T, B7-F, B7-T, B9-T, B10-T | 一時 DB（createTestDb、マイグレーション済み）。generationSeed で世界・エージェント・生成イベントを入れる | なし |  | TC-UT_CON-017 reply で C01〜C04 がそろえば、C01・C02・C03・C04 の順に返す | 過去の投稿（同じ性格・合う一人称）の検査で B7-F も通る |
| TC-UT_CON-018 | checkConsistency | 正常系 | 分岐網羅 | unfollow では C01〜C04 のどれも見ない | minato が haruka を 1 巡目に follow | 2 巡目に unfollow | 空の配列 | B1-T, B10-F | 一時 DB（createTestDb、マイグレーション済み）。generationSeed で世界・エージェント・生成イベントを入れる | 一部 TC-NOUS62_DEV-47（like だけ） |  | TC-UT_CON-018 unfollow では C01〜C04 のどれも見ない |  |
| TC-UT_CON-020 | checkConsistency | 正常系 | 状態遷移 | C01：解除の後にフォローし直した相手への返信は候補にしない | haruka の投稿、minato が 1 巡目に follow・2 巡目に unfollow・3 巡目に follow（継続中） | 4 巡目に reply | 空の配列（フォローし直した相手は「解除した相手」に当たらない） | B1-F, B2-F, B3-F | 一時 DB（createTestDb、マイグレーション済み）。generationSeed で世界・エージェント・生成イベントを入れる | なし | 疑い 1：最後の解除から 3 巡以内なら、フォローし直した後でも C01 の候補にする | TC-UT_CON-020 C01：解除の後にフォローし直した相手への返信は候補にしない | 2026-10-26 Kouhei Tajima さんの決定（NOUS-103） |
| TC-UT_CON-019 | splitSentences | 正常系 | 同値分割 | splitSentences は半角の ! ? でも切り、空の行は除く | なし | 一!二?\n\n三 | [一!, 二?, 三] |  | なし | 一部 TC-NOUS62_DEV-48（全角の句点だけ） |  | TC-UT_CON-019 splitSentences は半角の ! ? でも切り、空の行は除く |  |

## 3. 確認事項・バグの疑い

- 疑い 1：C01 は、解除の後にフォローし直した相手への返信も、最後の解除から 3 巡以内なら候補にする（TC-UT_CON-020）。2026-10-26 に Kouhei Tajima さんが、フォローし直した相手は「解除した相手」に当たらず矛盾としないと決めた。
- 確認事項 2：C04 の @ハンドルの取り出しは前の字を見ないため、「abc@example」のようなメールアドレスの形も @example として拾う。
- 確認事項 3：C02 は、非表示にされた自分の過去の投稿とも比べる（9章は「自分の過去の投稿」とだけある）。
- 確認事項 4：C03 の「うち」は「そのうち」「うちに」にも当たる。NOUS-62 で Jane Doe さんが挙げた点で、候補を記録するだけなので表のとおりを期待値にした（TC-UT_CON-013）。
- 確認事項 5：checkC01 の row.ended_cycle === null は、JOIN で解除のイベントが必ずあるため通らない。
