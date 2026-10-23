# 単体テスト観点表：入力の組み立てとトークン数の見積もり（generation/promptBuilder.ts・tokenEstimator.ts）

| 項目 | 内容 |
|---|---|
| 関連チケット | NOUS-102 |
| 作成者 | Takaya Ishikawa（開発担当） |
| 作成日 | 2026-10-23 |
| 対象 | apps/server/src/generation/promptBuilder.ts, apps/server/src/generation/tokenEstimator.ts |
| 言語 / フレームワーク | TypeScript / Vitest 2.1.9（environment: node） |
| テストファイル | apps/server/src/generation/promptBuilder.test.ts・tokenEstimator.test.ts（実装時、NOUS-61）, apps/server/src/generation/promptBuilder.ut.test.ts・tokenEstimator.ut.test.ts（単体テストで追加） |
| 外部依存 | テンプレートのファイル（prompts/v1 を読む。版の検査は一時ディレクトリに書いたテンプレートを promptsDir で渡す）, SQLite（loadTokenRatio。createTestDb の一時 DB） |
| 入力にした設計書 | BE 詳細設計 generation 4章 buildPrompt・sanitizeTimelineText・estimateTokens・loadTokenRatio, 行動生成とプロンプトの設計 5章・10章・11章 |

このファイルは `docs/test/unit/_build/build_matrix.py` で JSON から作る。直すときは JSON を直して作り直す。

## 1. 分岐の一覧

| ID | 条件 | 場所 |
|---|---|---|
| B1 | !PROMPT_VERSION_PATTERN.test(version) \|\| version.includes("..") | promptBuilder.ts:98 |
| B2 | cached（読み込み済みの版） | promptBuilder.ts:103 |
| B3 | readFileSync が例外（テンプレートが無い） | promptBuilder.ts:105-112 |
| B4 | value === undefined（値の無い項目） | promptBuilder.ts:124 |
| B5 | ref.replyToHandle（返信） | promptBuilder.ts:138 |
| B6 | remaining <= 0（記憶の上限に達した） | promptBuilder.ts:149 |
| B7 | chars.length <= remaining（切らずに入る） | promptBuilder.ts:151 |
| B8 | content.length > 0（空でなければ入れる） | promptBuilder.ts:153 |
| B9 | entries.length === 0（記憶が無い） | promptBuilder.ts:159 |
| B10 | candidates.includes("follow") && followTargets.length > 0 | promptBuilder.ts:170 |
| B11 | candidates.includes("unfollow") && followees.length > 0 | promptBuilder.ts:173 |
| B12 | sections.length === 0（相手の一覧を入れない） | promptBuilder.ts:176 |
| B13 | refs.length === 0（タイムラインが空） | promptBuilder.ts:215 |
| B14 | tokens <= max_input_tokens（上限に収まった） | promptBuilder.ts:243 |
| B15 | refs.length > 0（参照する投稿を外す） | promptBuilder.ts:246 |
| B16 | summary && summary.content.length > 0（会話の要約を切る） | promptBuilder.ts:252 |
| B17 | content.length > 0（切った要約が残る。偽なら要約を除く） | promptBuilder.ts:257 |
| B18 | Math.max(0.6, ratio)（ratio が 0.6 を超える） | tokenEstimator.ts:23 |
| B19 | row.chars > 0 && row.promptTokens > 0（使える行） | tokenEstimator.ts:47 |
| B20 | rows.length < 20（既定の比を使う） | tokenEstimator.ts:48 |

## 2. ケースの一覧（53 件。うち新しく足したもの 32 件）

| ID | 対象 | 分類 | 技法 | 観点 | 前提 | 入力 | 期待結果 | 分岐 | モック | 既存テストとの対応 | バグの疑い | テスト名 | 備考 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| TC-NOUS61_DEV-31 | estimateTokens | 正常系 | 開発者テスト | 全メッセージの文字数に 0.6 を掛けて切り上げる | なし | 10 字＋5 字、比 0.5 と 0.6 | どちらも 9 | B18-F | なし | 実装時のテスト（NOUS-61） |  | TC-NOUS61_DEV-31 全メッセージの文字数に 0.6 を掛けて切り上げる |  |
| TC-NOUS61_DEV-32 | estimateTokens | 正常系 | 開発者テスト | 実測の比が 0.6 を超えればその比を使う | なし | 100 字、比 0.75 | 75 | B18-T | なし | 実装時のテスト（NOUS-61） |  | TC-NOUS61_DEV-32 実測の比が 0.6 を超えればその比を使う |  |
| TC-NOUS61_DEV-33 | countChars | 正常系 | 開発者テスト | 文字数はコードポイントで数える（サロゲートペアは 1 字） | なし | "𠮷野家" | 3 |  | なし | 実装時のテスト（NOUS-61） |  | TC-NOUS61_DEV-33 文字数はコードポイントで数える（サロゲートペアは 1 字） |  |
| TC-NOUS61_DEV-34 | loadTokenRatio | 正常系 | 開発者テスト | 成功した LLM の生成が 20 件未満なら 0.6 | 成功した LLM の生成 19 件 | DB | 0.6 | B19-T, B20-T | 一時 DB（createTestDb） | 実装時のテスト（NOUS-61） |  | TC-NOUS61_DEV-34 成功した LLM の生成が 20 件未満なら 0.6 |  |
| TC-NOUS61_DEV-35 | loadTokenRatio | 正常系 | 開発者テスト | 20 件以上なら prompt_tokens ÷ 文字数の平均 | 70 トークン / 100 字 を 20 件 | DB | 0.7 | B19-T, B20-F | 一時 DB（createTestDb） | 実装時のテスト（NOUS-61） |  | TC-NOUS61_DEV-35 20 件以上なら prompt_tokens ÷ 文字数の平均 |  |
| TC-NOUS61_DEV-36 | loadTokenRatio | 正常系 | 開発者テスト | 直近 50 件だけを使い、参加の判定（gate）の行は数えない | 古い 0.5 を 30 件、新しい 0.8 を 50 件、gate を 5 件 | DB | 0.8 | B19-T, B20-F | 一時 DB（createTestDb） | 実装時のテスト（NOUS-61） |  | TC-NOUS61_DEV-36 直近 50 件だけを使い、参加の判定（gate）の行は数えない |  |
| TC-NOUS61_DEV-51 | buildPrompt | 正常系 | 開発者テスト | system 1 件・user 1 件で、人格・記憶・候補・規則・タイムラインを入れる | リポジトリの prompts/v1 | 候補 post・reply、参照する投稿 3 件 | system に人格・記憶・候補・規則、user に <timeline> と依頼。refs は 3 件 | B1-F, B4-F, B5-F, B7-T, B8-T, B9-F, B12-T, B13-F, B14-T | なし | 実装時のテスト（NOUS-61） |  | TC-NOUS61_DEV-51 system 1 件・user 1 件で、人格・記憶・候補・規則・タイムラインを入れる |  |
| TC-NOUS61_DEV-52 | formatTimelineLine | 正常系 | 開発者テスト | 返信には返信先のハンドルを付ける | リポジトリの prompts/v1 | replyToHandle=zen | （@zen への返信）を付ける | B5-T | なし | 実装時のテスト（NOUS-61） |  | TC-NOUS61_DEV-52 返信には返信先のハンドルを付ける |  |
| TC-NOUS61_DEV-53 | buildPrompt | 正常系 | 開発者テスト | 相手の一覧は候補に follow・unfollow があるときだけ入れる | リポジトリの prompts/v1 | 候補 post・like / follow・post / unfollow・post | follow・unfollow のときだけその一覧 | B10-T, B10-F, B11-T, B11-F, B12-T, B12-F | なし | 実装時のテスト（NOUS-61） |  | TC-NOUS61_DEV-53 相手の一覧は候補に follow・unfollow があるときだけ入れる |  |
| TC-NOUS61_DEV-54 | sanitizeTimelineText | 異常系 | 開発者テスト | 本文の </timeline> を全角にし、改行を空白にする（区切りの外に出さない） | リポジトリの prompts/v1 | </timeline>・</TIMELINE>・LF・CRLF を含む本文、指示の混入 | ＜/timeline＞と空白に置き換え、閉じタグは 1 つだけ |  | なし | 実装時のテスト（NOUS-61） |  | TC-NOUS61_DEV-54 本文の </timeline> を全角にし、改行を空白にする（区切りの外に出さない） |  |
| TC-NOUS61_DEV-55 | renderTemplate | 異常系 | 開発者テスト | 値の中の {{…}} は展開しない | リポジトリの prompts/v1 | personality に {{memory}} | そのまま残る | B4-F | なし | 実装時のテスト（NOUS-61） |  | TC-NOUS61_DEV-55 値の中の {{…}} は展開しない |  |
| TC-NOUS61_DEV-56 | renderTemplate | 異常系 | 開発者テスト | テンプレートに値の無い項目があれば ConfigError | なし | "{{unknown}}" | ConfigError | B4-T | なし | 実装時のテスト（NOUS-61） |  | TC-NOUS61_DEV-56 テンプレートに値の無い項目があれば ConfigError |  |
| TC-NOUS61_DEV-57 | buildPrompt | 正常系 | 開発者テスト | 見積もりが上限を超える間、参照する投稿を古い順に外し、P1 から番号を付け直す | リポジトリの prompts/v1 | 長い本文の投稿 12 件、上限を全量の見積もり − 50 | 上限以下、新しいほうが残る、P1 から振り直し | B14-T, B14-F, B15-T | なし | 実装時のテスト（NOUS-61） |  | TC-NOUS61_DEV-57 見積もりが上限を超える間、参照する投稿を古い順に外し、P1 から番号を付け直す |  |
| TC-NOUS61_DEV-58 | buildPrompt | 正常系 | 開発者テスト | 投稿をすべて外しても超えれば conversation_summary を後ろから切り詰める | リポジトリの prompts/v1 | 会話の要約 300 字、投稿 1 件、上限を要約なしの見積もり＋60 | refs は空、要約は先頭が残り 300 字未満、上限以下 | B15-T, B15-F, B16-T, B17-T | なし | 実装時のテスト（NOUS-61） |  | TC-NOUS61_DEV-58 投稿をすべて外しても超えれば conversation_summary を後ろから切り詰める |  |
| TC-NOUS61_DEV-59 | buildPrompt | 異常系 | 開発者テスト | 記憶を切っても超えれば PromptTooLargeError | リポジトリの prompts/v1 | 上限 100 | PromptTooLargeError | B15-F, B16-T, B16-F, B17-F | なし | 実装時のテスト（NOUS-61） |  | TC-NOUS61_DEV-59 記憶を切っても超えれば PromptTooLargeError |  |
| TC-NOUS61_DEV-60 | buildPrompt | 正常系 | 開発者テスト | 実測の比が大きければ、同じ上限でも外す投稿が増える | リポジトリの prompts/v1 | 比 0.6 と 0.9、上限 1000 | 0.9 のほうが refs が少ない | B14-F, B15-T, B18-T, B18-F | なし | 実装時のテスト（NOUS-61） |  | TC-NOUS61_DEV-60 実測の比が大きければ、同じ上限でも外す投稿が増える |  |
| TC-NOUS61_DEV-61 | fitMemories | 正常系 | 開発者テスト | 記憶は固定の順で、合計 max_memory_chars まで（後ろから切る） | なし | 100 字 × 3、上限 250 / 上限 0 | 100・100・50 / [] | B6-T, B7-T, B7-F, B8-T | なし | 実装時のテスト（NOUS-61） |  | TC-NOUS61_DEV-61 記憶は固定の順で、合計 max_memory_chars まで（後ろから切る） |  |
| TC-NOUS61_DEV-62 | buildPrompt | 正常系 | 開発者テスト | 記憶もタイムラインも無いときの文言 | リポジトリの prompts/v1 | 記憶なし、投稿なし | 「- まだない」「（まだ投稿はありません）」 | B9-T, B13-T | なし | 実装時のテスト（NOUS-61） |  | TC-NOUS61_DEV-62 記憶もタイムラインも無いときの文言 |  |
| TC-NOUS61_DEV-63 | loadTemplates | 異常系 | 開発者テスト | 版の名前がフォルダの外を指せば ConfigError、テンプレートが無ければ ConfigError | なし | "../etc"、"v1/../../x"、"v999" | ConfigError | B1-T, B1-F, B3-T | なし | 実装時のテスト（NOUS-61） |  | TC-NOUS61_DEV-63 版の名前がフォルダの外を指せば ConfigError、テンプレートが無ければ ConfigError |  |
| TC-NOUS61_DEV-64 | buildPrompt | 正常系 | 開発者テスト | promptsDir の版のテンプレートを使う | 一時ディレクトリに版 vt のテンプレート | prompt_version=vt、promptsDir | "S minato post"、"U [P1] 住人1 @user_1: 投稿 1" | B1-F, B2-F, B3-F, B12-T | なし | 実装時のテスト（NOUS-61） |  | TC-NOUS61_DEV-64 promptsDir の版のテンプレートを使う |  |
| TC-NOUS61_DEV-65 | promptText | 正常系 | 開発者テスト | promptText は system と user を空行でつなぐ | なし | system "s"、user "u" | "s\n\nu" |  | なし | 実装時のテスト（NOUS-61） |  | TC-NOUS61_DEV-65 promptText は system と user を空行でつなぐ |  |
| TC-UT_PRM-001 | estimateTokens | 正常系 | 境界値 | メッセージが無い・本文が空なら 0 | なし | []、本文が空の 1 件（比 0.9） | 0 | B18-F, B18-T | なし | なし |  | TC-UT_PRM-001 メッセージが無い・本文が空なら 0 |  |
| TC-UT_PRM-002 | estimateTokens | 正常系 | 境界値 | 実測の比が 0.6 未満でも 0.6 を下限にする（比 0） | なし | 10 字、比 0 | 6 | B18-F | なし | 一部 TC-NOUS61_DEV-31（比 0.5 だけ） |  | TC-UT_PRM-002 実測の比が 0.6 未満でも 0.6 を下限にする |  |
| TC-UT_PRM-003 | estimateTokens | 正常系 | 境界値 | 端数は切り上げる（1 字 × 0.6 = 1） | なし | 1 字、比 0.6 | 1 | B18-F | なし | 一部 TC-NOUS61_DEV-31 |  | TC-UT_PRM-003 端数は切り上げる（1 字 × 0.6 = 1） |  |
| TC-UT_PRM-004 | countChars | 正常系 | 境界値 | 空の文字列の文字数は 0 | なし | "" | 0 |  | なし | なし |  | TC-UT_PRM-004 空の文字列の文字数は 0 |  |
| TC-UT_PRM-005 | loadTokenRatio | 正常系 | 境界値 | ちょうど 20 件なら実測の比を使う（20 件未満の境界） | 90 トークン / 100 字 を 20 件 | DB | 0.9 | B19-T, B20-F | 一時 DB（createTestDb） | 一部 TC-NOUS61_DEV-34・35（19 件と 20 件の値の違いを比で見ていない） |  | TC-UT_PRM-005 ちょうど 20 件なら実測の比を使う |  |
| TC-UT_PRM-006 | loadTokenRatio | 正常系 | 境界値 | 生成イベントが 1 件も無ければ 0.6 | 生成イベントなし | DB | 0.6 | B20-T | 一時 DB（createTestDb） | なし |  | TC-UT_PRM-006 生成イベントが 1 件も無ければ 0.6 |  |
| TC-UT_PRM-007 | loadTokenRatio | 異常系 | 分岐網羅 | prompt_tokens が 0 の行は平均にも件数にも入れない | 70/100 を 20 件、そのあと 0/100 を 5 件 | DB | 0.7 | B19-T, B19-F, B20-F | 一時 DB（createTestDb） | 一部 TC-NOUS61_DEV-36（0 の行は gate の行だけ） |  | TC-UT_PRM-007 prompt_tokens が 0 の行は平均にも件数にも入れない |  |
| TC-UT_PRM-008 | loadTokenRatio | 異常系 | 同値分割 | 失敗した生成と、prompt_text の無い行・空の行は数えない | 70/100 を 19 件、失敗 1 件、prompt_text が NULL 1 件・空 1 件 | DB | 0.6（使える行が 19 件） | B19-T, B19-F, B20-T | 一時 DB（createTestDb） | なし |  | TC-UT_PRM-008 失敗した生成と、prompt_text の無い行・空の行は数えない |  |
| TC-UT_PRM-009 | loadTokenRatio | 異常系 | 境界値 | 直近 50 件の中で使える行が 20 件未満なら、それより古い行があっても 0.6 | 古い 70/100 を 30 件、80/100 を 19 件、新しい 0/100 を 31 件 | DB | 0.6 | B19-T, B19-F, B20-T | 一時 DB（createTestDb） | なし |  | TC-UT_PRM-009 直近 50 件の中で使える行が 20 件未満なら、それより古い行があっても 0.6 | 設計書 4章の「直近 50 件の平均」どおり。50 件を取ってから使えない行を除くため、使える行は 50 件より少なくなる |
| TC-UT_PRM-010 | sanitizeTimelineText | 異常系 | 同値分割 | 改行が CR だけでも空白にする | なし | "a\rb" | "a b" |  | なし | 一部 TC-NOUS61_DEV-54（LF と CRLF だけ） |  | TC-UT_PRM-010 改行が CR だけでも空白にする |  |
| TC-UT_PRM-011 | sanitizeTimelineText | 異常系 | 同値分割 | 置き換えるのは </timeline> だけで、開きタグと空白の入った閉じタグはそのまま | なし | "<timeline>x"、"</timeline >x</ timeline>" | 入力のまま |  | なし | なし |  | TC-UT_PRM-011 置き換えるのは </timeline> だけで、開きタグと空白の入った閉じタグはそのまま | 設計書 11章は </timeline> の置き換えだけを定める（設計どおり）。issues の確認事項 2 |
| TC-UT_PRM-012 | buildPrompt | 異常系 | 同値分割 | 表示名の </timeline> と改行も、タイムラインと相手の一覧で整える | リポジトリの prompts/v1 | 表示名に </timeline> と改行を含む投稿とフォローできる住人 | 閉じタグは 1 つだけ。表示名は＜/timeline＞と空白に置き換わる | B10-T, B12-F | なし | 一部 TC-NOUS61_DEV-54（本文だけ） |  | TC-UT_PRM-012 表示名の </timeline> と改行も、タイムラインと相手の一覧で整える |  |
| TC-UT_PRM-013 | renderTemplate | 異常系 | 同値分割 | 値の中の $& や $1 は、そのままの文字として入れる（置換の特殊なパターンにしない） | なし | "[{{a}}]"、a="$&-$1-$$" | "[$&-$1-$$]" | B4-F | なし | なし |  | TC-UT_PRM-013 値の中の $& や $1 は、そのままの文字として入れる |  |
| TC-UT_PRM-014 | renderTemplate | 正常系 | 同値分割 | 英小文字と _ 以外を含む {{…}} は項目として扱わず、そのまま残す | なし | "{{Name}} {{a1}} {{a}}"、a="x" | "{{Name}} {{a1}} x" | B4-F | なし | なし |  | TC-UT_PRM-014 英小文字と _ 以外を含む {{…}} は項目として扱わず、そのまま残す | 設計書に記載なし。実装の値 |
| TC-UT_PRM-015 | loadTemplates | 異常系 | 境界値 | 版の名前が規則に合わなければ、フォルダがあっても ConfigError | 一時ディレクトリに同じ名前のフォルダ | ""、".hidden"、21 字、"v1/x"（it.each） | ConfigError、文言に「版の名前が不正」 | B1-T | なし | 一部 TC-NOUS61_DEV-63（.. を含むものだけ） |  | TC-UT_PRM-015 版の名前が規則に合わなければ、フォルダがあっても ConfigError |  |
| TC-UT_PRM-016 | loadTemplates | 正常系 | 境界値 | 版の名前は 20 字まで、. を途中に含めてよい | 一時ディレクトリに 20 字の版と v1.1 の版 | 20 字の名前、"v1.1" | それぞれの system.md の内容 | B1-F, B2-F, B3-F | なし | なし |  | TC-UT_PRM-016 版の名前は 20 字まで、. を途中に含めてよい | 上限 20 字は設計書に記載なし。実装の値 |
| TC-UT_PRM-017 | loadTemplates | 正常系 | 状態遷移 | テンプレートは版ごとに1回だけ読み、後でファイルを変えても同じ内容を使う | 一時ディレクトリに版 vc | 読んだあとに system.md を書き換えて、もう一度読む | 2 回とも最初の内容 | B2-F, B2-T | なし | なし |  | TC-UT_PRM-017 テンプレートは版ごとに1回だけ読み、後でファイルを変えても同じ内容を使う | 設計書 10章は版の切り替えを P205 で行う。同じ版の中身を変えたときは再起動が要る（実装の値） |
| TC-UT_PRM-018 | loadTemplates | 異常系 | エラー処理 | user.md だけが無いときも ConfigError | 一時ディレクトリに system.md だけ | 版 vs | ConfigError | B1-F, B2-F, B3-T | なし | 一部 TC-NOUS61_DEV-63（フォルダごと無いときだけ） |  | TC-UT_PRM-018 user.md だけが無いときも ConfigError |  |
| TC-UT_PRM-019 | buildPrompt | 正常系 | 境界値 | 見積もりが上限ちょうどなら投稿を外さず、上限を 1 下げると最も古い 1 件を外す | リポジトリの prompts/v1 | 投稿 5 件、上限 = 全量の見積もり / 見積もり − 1 | 5 件 / post-2〜5 の 4 件 | B14-T, B14-F, B15-T | なし | 一部 TC-NOUS61_DEV-57（ちょうどのときを見ていない） |  | TC-UT_PRM-019 見積もりが上限ちょうどなら投稿を外さず、上限を 1 下げると 1 件外す |  |
| TC-UT_PRM-020 | buildPrompt | 正常系 | 境界値 | 実測の比が 0.6 未満なら 0.6 として扱う（外す投稿が同じ） | リポジトリの prompts/v1 | 投稿 12 件、上限 1000、比 0.3 と 0.6 | refs が等しい | B14-F, B15-T, B18-F | なし | 一部 TC-NOUS61_DEV-60（0.6 を超える側だけ） |  | TC-UT_PRM-020 実測の比が 0.6 未満なら 0.6 として扱う |  |
| TC-UT_PRM-021 | buildPrompt | 正常系 | 同値分割 | 会話の要約を切り詰めても、ほかの記憶（関心のプロフィール）は切らない | リポジトリの prompts/v1 | 関心 100 字、要約 300 字、投稿なし、上限を要約なしの見積もり＋30 | 関心はそのまま、要約は 300 字未満 | B14-F, B15-F, B16-T, B17-T | なし | 一部 TC-NOUS61_DEV-58（ほかの記憶を見ていない） |  | TC-UT_PRM-021 会話の要約を切り詰めても、ほかの記憶は切らない |  |
| TC-UT_PRM-022 | buildPrompt | 異常系 | エラー処理 | 会話の要約が無ければ、投稿を外しきった時点で PromptTooLargeError（見積もりと上限を持つ） | リポジトリの prompts/v1 | 関心だけの記憶、投稿 1 件、上限 = 投稿なしの見積もり − 1 | PromptTooLargeError、estimatedTokens = 投稿なしの見積もり、maxInputTokens = 上限 | B15-T, B15-F, B16-F | なし | 一部 TC-NOUS61_DEV-59（例外の型だけ） |  | TC-UT_PRM-022 会話の要約が無ければ、投稿を外しきった時点で PromptTooLargeError（見積もりと上限を持つ） |  |
| TC-UT_PRM-023 | buildPrompt | 正常系 | 同値分割 | 記憶の改行は空白にし、usedMemories には max_memory_chars で切った内容を残す | リポジトリの prompts/v1 | 改行を含む記憶 57 字、max_memory_chars 10 | system は「一行目 二行目xxx」、usedMemories は改行を残した 10 字 | B7-F, B8-T, B9-F | なし | 一部 TC-NOUS61_DEV-61（fitMemories だけで、入力への入り方は見ていない） |  | TC-UT_PRM-023 記憶の改行は空白にし、usedMemories には max_memory_chars で切った内容を残す |  |
| TC-UT_PRM-024 | buildPrompt | 正常系 | 同値分割 | 選び方の目安は候補の順に並べ、最後に none を付ける | リポジトリの prompts/v1 | 候補 unfollow・like・post・follow | 目安がその順で、最後に none。「今回選べる行動は unfollow・like・post・follow です」 | B10-T, B11-T, B12-F | なし | 一部 TC-NOUS61_DEV-51（2 つの候補の有無だけ） |  | TC-UT_PRM-024 選び方の目安は候補の順に並べ、最後に none を付ける |  |
| TC-UT_PRM-025 | buildPrompt | 正常系 | 分岐網羅 | 候補に follow があっても、フォローできる住人がいなければ一覧を入れない | リポジトリの prompts/v1 | 候補 follow・post、フォローできる住人なし | 「フォローできる住人」を含まない | B10-F, B11-F, B12-T | なし | なし |  | TC-UT_PRM-025 候補に follow があっても、フォローできる住人がいなければ一覧を入れない | availableActions が follow を候補に入れないので通常は起きない。防御の分岐を通す |
| TC-UT_PRM-026 | buildPrompt | 正常系 | 分岐網羅 | 候補に unfollow があっても、フォロー中の住人がいなければ一覧を入れない | リポジトリの prompts/v1 | 候補 unfollow・post、フォロー中の住人なし | 「フォロー中の住人」を含まない | B10-F, B11-F, B12-T | なし | なし |  | TC-UT_PRM-026 候補に unfollow があっても、フォロー中の住人がいなければ一覧を入れない | TC-UT_PRM-025 と同じく防御の分岐 |
| TC-UT_PRM-027 | fitMemories | 正常系 | 境界値 | 字数をコードポイントで数える（サロゲートペアは 1 字） | なし | "𠮷𠮷𠮷"、上限 2 | "𠮷𠮷" | B7-F, B8-T | なし | なし |  | TC-UT_PRM-027 fitMemories は字数をコードポイントで数える（サロゲートペアは 1 字） |  |
| TC-UT_PRM-028 | fitMemories | 異常系 | 境界値 | 上限が負なら空、上限に達したら後ろの記憶を入れない | なし | 5 字 × 3、上限 −1 / 上限 5 | [] / 先頭の 1 件だけ | B6-T, B7-T, B8-T | なし | 一部 TC-NOUS61_DEV-61（上限 0 だけ） |  | TC-UT_PRM-028 fitMemories は上限が負なら空、上限に達したら後ろの記憶を入れない |  |
| TC-UT_PRM-029 | fitMemories | 異常系 | 分岐網羅 | 内容が空の記憶を入れない | なし | 空の interest_profile と "b"、上限 10 | [recent_posts の "b"] だけ | B6-F, B7-T, B8-F, B8-T | なし | なし |  | TC-UT_PRM-029 fitMemories は内容が空の記憶を入れない | loadMemories が空の記憶を除くので通常は起きない。防御の分岐を通す |
| TC-UT_PRM-030 | buildPrompt | 正常系 | 依存 | 入力の context を書き換えない（refs・memories を外すのは戻り値の側だけ） | リポジトリの prompts/v1 | 投稿 12 件、上限 800 | 呼ぶ前と後の context が等しい | B14-F, B15-T | なし | なし |  | TC-UT_PRM-030 入力の context を書き換えない |  |
| TC-UT_PRM-031 | buildPrompt | 正常系 | 分岐網羅 | 参照する投稿をすべて外しても、候補の reply・like はそのまま入力に残る | リポジトリの prompts/v1 | 長い本文の投稿 1 件、候補 reply・like、上限 = 投稿なしの見積もり | refs は []、system に「reply・like」、user に「（まだ投稿はありません）」 | B13-T, B14-F, B14-T, B15-T | なし | なし |  | TC-UT_PRM-031 参照する投稿をすべて外しても、候補の reply・like はそのまま入力に残る | 設計書は候補の抽選（drawCandidates）を buildPrompt の前に行う順序だけを定め、投稿を外しきったときの候補の扱いは記載なし。実装の値。issues の確認事項 1 |
| TC-UT_PRM-032 | promptText | 正常系 | 境界値 | メッセージが 1 件ならその本文、0 件なら空の文字列 | なし | 1 件、0 件 | "u"、"" |  | なし | 一部 TC-NOUS61_DEV-65（2 件だけ） |  | TC-UT_PRM-032 promptText はメッセージが 1 件ならその本文、0 件なら空の文字列 |  |

## 3. 確認事項・バグの疑い

- 確認事項 1：候補は buildPrompt の前に、外す前の参照する投稿で抽選する（設計書 1章・4章の順序どおり）。上限のために参照する投稿をすべて外すと、候補に reply・like が残ったまま、タイムラインが「（まだ投稿はありません）」になる（TC-UT_PRM-031）。LLM が reply・like を選ぶと P 番号が無く、検証で不正な形式になり再生成に回る。候補から外すか、このままでよいかを確認したい。
- 確認事項 2：区切りの無害化は </timeline> だけを置き換える（設計書 11章どおり、TC-UT_PRM-011）。</timeline >・</ timeline> のような揺れや、記憶（会話の要約は他の住人の投稿の先頭 40 字を含む）は system に整えずに入る。NFR-S-012 の「他の住人の投稿は <timeline> の中だけ」と、5.1 の「記憶は system」の関係を、設計として確認したい。会話の要約の作り方は NOUS-103（memoryUpdater）の観点でも見る。
- 確認事項 3：テンプレートは版ごとにプロセスの中で1回だけ読む（TC-UT_PRM-017）。同じ版のファイルを直したときは再起動が要る。設計書 10章の「新しい版のフォルダを作る」運用なら問題ないが、運用の手順に一言あるとよい。
