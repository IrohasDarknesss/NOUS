# 単体テスト観点表：1 回の行動機会の実行（generation/opportunityRunner.ts）

| 項目 | 内容 |
|---|---|
| 関連チケット | NOUS-104 |
| 作成者 | Takaya Ishikawa（開発担当） |
| 作成日 | 2026-10-23 |
| 対象 | apps/server/src/generation/opportunityRunner.ts |
| 言語 / フレームワーク | TypeScript / Vitest 2.1.9（environment: node） |
| テストファイル | apps/server/src/generation/opportunityRunner.test.ts（実装時、NOUS-63・83）, apps/server/src/generation/opportunityRunner.ut.test.ts（単体テストで追加） |
| 外部依存 | DB（worlds・world_settings・agents・generation_events・generation_attempts・posts・likes・memories・daily_usage・daily_metrics）, 時計（FakeClock）, LLM（LlmClient を満たす差し替え）, 生成の設定（GenerationConfig）, プロンプトのテンプレート（prompts/）, AbortSignal（signal・stopSignal）, ロガー |
| 入力にした設計書 | BE 詳細設計 generation 2章 runOpportunity・4章（createEvent・closeGateNone・generateAndValidate・commitAction・closeFailed・closeCancelled）・6章, 行動生成とプロンプトの設計 3章・6章, NOUS-63（試行は 1 つの生成イベントで 4 回まで）, NOUS-83（AC-P06） |

このファイルは `docs/test/unit/_build/build_matrix.py` で JSON から作る。直すときは JSON を直して作り直す。

## 1. 分岐の一覧

| ID | 条件 | 場所 |
|---|---|---|
| B1 | getEventUsageDate：生成イベントの行がある（偽なら時計の日付） | opportunityRunner.ts:97 |
| B2 | createEvent：world を渡された／読めた（偽なら例外） | opportunityRunner.ts:113-116 |
| B3 | createEvent：settings を渡された／読めた（偽なら例外） | opportunityRunner.ts:118-122 |
| B4 | closeFailed：lastOutput が null・undefined でない | opportunityRunner.ts:194 |
| B5 | generateAndValidate：ctx.settings か DB にモデル・出力の上限がある（偽なら既定の @cf/google/gemma-4-26b-a4b-it・300） | opportunityRunner.ts:237-238 |
| B6 | generateAndValidate：上限の設定が DB か ctx.settings（2 つとも揃うとき）にある（偽なら上限を見ない） | opportunityRunner.ts:239-246 |
| B7 | generateAndValidate：validationContext が無い（agentContext か loadContext から作る） | opportunityRunner.ts:251 |
| B8 | generateAndValidate：handle が無い（loadAgent で読む） | opportunityRunner.ts:267 |
| B9 | generateAndValidate：検証で InvalidFormatError | opportunityRunner.ts:326 |
| B10 | generateAndValidate：1 回目の生成（再生成する） | opportunityRunner.ts:346 |
| B11 | commitAction：DuplicateActionError（偽なら投げ直す） | opportunityRunner.ts:429 |
| B12 | commitAction：outputText が null でない | opportunityRunner.ts:443 |
| B13 | runOpportunity：世界が無い | opportunityRunner.ts:477 |
| B14 | runOpportunity：world_settings が無い | opportunityRunner.ts:481 |
| B15 | runOpportunity：loadAgent が AgentNotActiveError（skipped） | opportunityRunner.ts:489 |
| B16 | runOpportunity：不参加（closeGateNone） | opportunityRunner.ts:512 |
| B17 | runOpportunity：commitAction が failed | opportunityRunner.ts:562 |
| B18 | catch：FreeTierExceededError | opportunityRunner.ts:584 |
| B19 | catch：取り消し（isCancellation） | opportunityRunner.ts:590 |
| B20 | catch：StoppedError | opportunityRunner.ts:603 |
| B21 | catch：AgentNotActiveError（作成後） | opportunityRunner.ts:616 |
| B22 | catch：TemporaryFailureError | opportunityRunner.ts:632 |
| B23 | catch：InvalidFormatError | opportunityRunner.ts:644 |
| B24 | catch：想定外の例外（server_error） | opportunityRunner.ts:656 |
| B25 | runOpportunity：promptsDir が渡されている | opportunityRunner.ts:534 |

## 2. ケースの一覧（33 件。うち新しく足したもの 20 件）

| ID | 対象 | 分類 | 技法 | 観点 | 前提 | 入力 | 期待結果 | 分岐 | モック | 既存テストとの対応 | バグの疑い | テスト名 | 備考 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| TC-NOUS63_DEV-15 | runOpportunity | 正常系 | 開発者テスト | 稼働中でなければ生成イベントを作らず skipped | 一時 DB（createTestDb）、FakeClock 2026-10-22T09:00:00.000Z、停止中のエージェント | 停止中の agentId | skipped、LLM を呼ばない、生成イベント 0 件 | B15-T | LLM の差し替え | 実装時のテスト（NOUS-63） |  | TC-NOUS63_DEV-15 対象のエージェントが稼働中でなければ生成イベントを作らず skipped を返す |  |
| TC-NOUS63_DEV-16 | runOpportunity / closeGateNone | 正常系 | 開発者テスト | gate で不参加なら LLM を呼ばず nones だけ +1 | 一時 DB（createTestDb）、FakeClock 2026-10-22T09:00:00.000Z | 参加の確率 0 | succeeded・none・gate、nones=1、daily_usage 0 件 | B16-T | LLM の差し替え | 実装時のテスト（NOUS-63） |  | TC-NOUS63_DEV-16 gate で不参加のときは closeGateNone で閉じ、LLM を呼ばず daily_metrics.nones だけ +1 する |  |
| TC-NOUS63_DEV-17 | runOpportunity / commitAction | 正常系 | 開発者テスト | post の成功で入力・出力・投稿・記憶・矛盾・利用量・指標を記録 | 一時 DB（createTestDb）、FakeClock 2026-10-22T09:00:00.000Z | post の JSON | succeeded・post、各テーブルの値 | B5-T, B6-T, B7-T, B8-F, B9-F, B13-F, B14-F, B15-F, B16-F, B17-F, B25-F | LLM の差し替え | 実装時のテスト（NOUS-63） |  | TC-NOUS63_DEV-17 参加して post が成功すると入力・出力・投稿・記憶・矛盾フラグ・daily_usage・daily_metrics が記録される |  |
| TC-NOUS63_DEV-18 | runOpportunity / generateAndValidate | 正常系 | 開発者テスト | 1 回目が不正な形式でも 1 回だけ再生成して成功 | 一時 DB（createTestDb）、FakeClock 2026-10-22T09:00:00.000Z | 不正な出力 → post | succeeded、試行 2 件、daily_usage calls=2・runs=1 | B9-T, B10-T | LLM の差し替え | 実装時のテスト（NOUS-63） | 1 回目（invalid_format）の Neurons を 0 とし、daily_usage.neurons を 7.0 とする期待値が、疑い 1 と食い違う | TC-NOUS63_DEV-18 1 回目の出力が不正な形式でも同じ prompt で 1 回だけ再生成して成功できる |  |
| TC-NOUS63_DEV-19 | runOpportunity | 異常系 | 開発者テスト | 再生成でも不正なら invalid_format で閉じ、最後の出力を残す | 一時 DB（createTestDb）、FakeClock 2026-10-22T09:00:00.000Z | 不正な出力 2 回 | failed・invalid_format、output_text は 2 回目 | B10-F, B23-T, B4-T | LLM の差し替え | 実装時のテスト（NOUS-63） |  | TC-NOUS63_DEV-19 再生成でも不正な形式なら closeFailed（invalid_format）で閉じ、最後の output_text を残す |  |
| TC-NOUS63_DEV-20 | commitAction | 異常系 | 開発者テスト | DuplicateActionError でロールバックし、invalid_format と error_detail を記録 | 一時 DB（createTestDb）、FakeClock 2026-10-22T09:00:00.000Z、いいね済みの投稿 | 同じ投稿へのいいね | failed・invalid_format、最後の試行の error_detail | B11-T, B12-T | なし | 実装時のテスト（NOUS-63） |  | TC-NOUS63_DEV-20 commitAction で DuplicateActionError が起きたらロールバックし、別トランザクションで invalid_format と error_detail を記録する |  |
| TC-NOUS63_DEV-21 | runOpportunity | 異常系 | 開発者テスト | 3036 は free_tier で閉じてから投げ直す | 一時 DB（createTestDb）、FakeClock 2026-10-22T09:00:00.000Z | FreeTierExceededError | 例外、failed・free_tier、runs=1・failures=1 | B18-T | LLM の差し替え | 実装時のテスト（NOUS-63） |  | TC-NOUS63_DEV-21 FreeTierExceededError は closeFailed（free_tier）で閉じてから呼び出し元に投げ直す |  |
| TC-NOUS63_DEV-22 | runOpportunity | 異常系 | 開発者テスト | 取り消しの 3 通りは cancelled で閉じる | 一時 DB（createTestDb）、FakeClock 2026-10-22T09:00:00.000Z | LLM・時計の CancelledError、abort 済みの signal | cancelled・cancelled、runs=3 | B19-T | LLM の差し替え | 実装時のテスト（NOUS-63） |  | TC-NOUS63_DEV-22 取り消し（ClockCancelledError・LlmCancelledError・signal.aborted）は closeCancelled（cancelled）で閉じる |  |
| TC-NOUS63_DEV-23 | runOpportunity / closeCancelled / closeFailed / closeGateNone | 異常系 | 開発者テスト | 待ちの後の StoppedError は stopped で閉じる（close の関数の単体呼び出しも） | 一時 DB（createTestDb）、FakeClock 2026-10-22T09:00:00.000Z | 429 の後に shouldContinue=false | cancelled・stopped | B20-T, B4-T | LLM の差し替え | 実装時のテスト（NOUS-63） |  | TC-NOUS63_DEV-23 StoppedError（再試行待機後の停止）とイベント作成後の AgentNotActiveError は closeCancelled（stopped）で閉じる | 確認事項 3・4 |
| TC-NOUS63_DEV-24 | runOpportunity | 異常系 | 開発者テスト | TemporaryFailureError と想定外の例外は closeFailed で閉じ、投げ直さない | 一時 DB（createTestDb）、FakeClock 2026-10-22T09:00:00.000Z | timeout が続く／TypeError | failed・timeout／failed・server_error | B22-T, B24-T | LLM の差し替え | 実装時のテスト（NOUS-63） |  | TC-NOUS63_DEV-24 TemporaryFailureError と想定外の例外は closeFailed で閉じ、想定外の例外も投げ直さない | 確認事項 4 |
| TC-NOUS83_DEV-06 | runOpportunity | 異常系 | 開発者テスト | 待ち中の stopSignal で時計を進めずに cancelled・stopped（AC-P06） | 一時 DB（createTestDb）、FakeClock 2026-10-22T09:00:00.000Z | 429 の後に stopSignal を abort | cancelled・stopped、呼び出し 1 回 | B20-T | LLM の差し替え | 実装時のテスト（NOUS-83） |  | TC-NOUS83_DEV-06 runOpportunity は一時的な失敗の再試行待ちの途中で stopSignal が abort されたら時計を進めずに status=cancelled かつ failureKind=stopped で閉じる |  |
| TC-NOUS83_DEV-07 | runOpportunity | 異常系 | 開発者テスト | stopSignal が無くても shouldContinue の停止で stopped | 一時 DB（createTestDb）、FakeClock 2026-10-22T09:00:00.000Z | 429 の後に shouldContinue=false | cancelled・stopped | B20-T | LLM の差し替え | 実装時のテスト（NOUS-83） |  | TC-NOUS83_DEV-07 runOpportunity は stopSignal が渡されない場合でも従来どおり shouldContinue の停止で stopped で閉じる | 確認事項 4 |
| TC-NOUS83_DEV-08 | runOpportunity | 正常系 | 開発者テスト | LLM の呼び出し中の stopSignal では中止せずに succeeded | 一時 DB（createTestDb）、FakeClock 2026-10-22T09:00:00.000Z | 呼び出し中に stopSignal を abort して post | succeeded・post | B17-F | LLM の差し替え | 実装時のテスト（NOUS-83） |  | TC-NOUS83_DEV-08 runOpportunity は LLM 呼び出し中に stopSignal が abort されても中止せず完了して succeeded で閉じる |  |
| TC-UT_RUN-001 | runOpportunity | 異常系 | 分岐網羅 | 世界が無ければ生成イベントを作らずに例外 | 一時 DB（createTestDb）、FakeClock 2026-10-22T09:00:00.000Z | 存在しない worldId | 例外（World not found）、生成イベント 0 件 | B13-T | LLM の差し替え | なし |  | TC-UT_RUN-001 世界が無ければ生成イベントを作らずに例外を投げる |  |
| TC-UT_RUN-002 | runOpportunity | 異常系 | 分岐網羅 | world_settings が無ければ生成イベントを作らずに例外 | 一時 DB（createTestDb）、FakeClock 2026-10-22T09:00:00.000Z、world_settings の無い世界 | その世界の worldId・agentId | 例外（World settings not found）、生成イベント 0 件 | B14-T | LLM の差し替え | なし |  | TC-UT_RUN-002 world_settings が無ければ生成イベントを作らずに例外を投げる |  |
| TC-UT_RUN-003 | runOpportunity | 正常系 | 同値分割 | LLM が none を選んだら succeeded・decided_by=llm、runs と nones を 1 加算 | 一時 DB（createTestDb）、FakeClock 2026-10-22T09:00:00.000Z | none の JSON | succeeded・none・llm、daily_metrics runs=1・nones=1・posts=0、daily_usage calls=1・runs=1 | B9-F, B17-F | LLM の差し替え | なし（DEV は gate の none と post だけ） |  | TC-UT_RUN-003 LLM が none を選んだら succeeded・decided_by=llm で閉じ、daily_metrics は runs と nones を 1 加算する | 行動生成とプロンプトの設計 3章：LLM の none はエラー率の分母に入る |
| TC-UT_RUN-004 | runOpportunity / generateAndValidate | 異常系 | 境界値 | 最初の生成で 3 試行かかって不正なら、再生成は 4 回目の 1 回だけ。失敗すれば timeout で閉じる | 一時 DB（createTestDb）、FakeClock 2026-10-22T09:00:00.000Z | timeout・timeout・不正な出力・timeout | failed・timeout、呼び出し 4 回、試行 1〜4（timeout・timeout・invalid_format・timeout） | B10-T, B22-T | FakeClock 2026-10-22T09:00:00.000Z、LLM の差し替え | なし |  | TC-UT_RUN-004 最初の生成で 3 試行かかって不正な形式なら、再生成は 4 回目の 1 回だけで、失敗すれば timeout で閉じる | NOUS-63 の決定：1 つの生成イベントの試行は 4 回まで（attempt_no の CHECK） |
| TC-UT_RUN-005 | runOpportunity / generateAndValidate | 異常系 | 境界値 | 最初の生成が 1 試行で不正なら、再生成の側は 2〜4 回目の 3 回まで再試行する | 一時 DB（createTestDb）、FakeClock 2026-10-22T09:00:00.000Z | 不正な出力・timeout×3 | failed・timeout、呼び出し 4 回、試行 1〜4、daily_usage calls=4・runs=1 | B10-T, B22-T | FakeClock 2026-10-22T09:00:00.000Z、LLM の差し替え | なし |  | TC-UT_RUN-005 最初の生成が 1 試行で不正な形式なら、再生成の側は 2〜4 回目の 3 回まで再試行する |  |
| TC-UT_RUN-006 | runOpportunity | 異常系 | 状態遷移 | 生成イベントを作った後にエージェントが停止されたら、LLM を呼ばずに cancelled（stopped）で閉じる | 一時 DB（createTestDb）、FakeClock 2026-10-22T09:00:00.000Z | 参加の判定の時点でエージェントを停止する | cancelled・stopped、LLM を呼ばない、daily_metrics runs=1・failures=0 | B21-T | GenerationConfig の participation を読むときに agents.state を stopped にする | なし（DEV-23 は名前にあるが経路を通っていない） |  | TC-UT_RUN-006 生成イベントを作った後にエージェントが停止されたら、LLM を呼ばずに cancelled（stopped）で閉じる | 設計書 6章：作った後なら cancelled（stopped） |
| TC-UT_RUN-007 | runOpportunity | 異常系 | エラー処理 | 再生成の側が再試行しない失敗（401）なら server_error で閉じ、1 回目の不正な出力を残す | 一時 DB（createTestDb）、FakeClock 2026-10-22T09:00:00.000Z | 不正な出力・ServerError(401) | failed・server_error、output_text は 1 回目、runs=1・failures=1 | B22-T, B4-T | LLM の差し替え | なし |  | TC-UT_RUN-007 再生成の側が再試行しない失敗（401）なら server_error で閉じ、output_text に 1 回目の不正な出力を残す |  |
| TC-UT_RUN-008 | createEvent | 正常系 | 境界値 | usage_date を時計の UTC の日付にする（00:00 UTC の両側） | 一時 DB（createTestDb） | 時計 2026-10-22T23:59:59.999Z・2026-10-23T00:00:00.000Z | running・llm、usage_date 2026-10-22・2026-10-23、started_at は時計の時刻 | B2-T, B3-T | FakeClock（各時刻） | なし |  | TC-UT_RUN-008 createEvent は usage_date を時計の UTC の日付にする |  |
| TC-UT_RUN-009 | runOpportunity | 正常系 | 境界値 | 00:00 UTC をまたいで再試行したら、試行は呼んだ日の daily_usage に、指標は生成イベントの日の daily_metrics に入る | 一時 DB（createTestDb）、FakeClock 2026-10-22T23:59:50.000Z | timeout・post | 生成イベントの usage_date 2026-10-22、daily_usage 22 日 calls=1・runs=1、23 日 calls=1・runs=0・Neurons 6.5、daily_metrics は 22 日だけ | B1-T | FakeClock、LLM の差し替え | なし |  | TC-UT_RUN-009 00:00 UTC をまたいで再試行したら、試行は呼んだ日の daily_usage に、指標は生成イベントの日の daily_metrics に入る | 確認事項 2。設計書に記載なし。実装の値 |
| TC-UT_RUN-010 | commitAction | 異常系 | エラー処理 | DuplicateActionError 以外の例外（外部キーの違反）ならロールバックして、そのまま投げる | 一時 DB（createTestDb）、FakeClock 2026-10-22T09:00:00.000Z | 存在しない投稿へのいいね | 例外（DuplicateActionError でない）、likes 0 件、生成イベントは running のまま、daily_metrics 0 件 | B11-F | なし | なし |  | TC-UT_RUN-010 commitAction は DuplicateActionError 以外の例外（外部キーの違反）ならロールバックして、そのまま投げる | 設計書 6章：ロールバックの後に呼び出し元が closeFailed（想定外の例外は server_error） |
| TC-UT_RUN-011 | closeCancelled | 異常系 | 分岐網羅 | 生成イベントが見つからないとき、時計の UTC の日付の daily_metrics に runs を加算する | 一時 DB（createTestDb）、FakeClock 2026-10-23T01:00:00.000Z | 存在しない eventId | daily_metrics（2026-10-23）runs=1・failures=0 | B1-F | なし | なし |  | TC-UT_RUN-011 closeCancelled は生成イベントが見つからないとき、時計の UTC の日付の daily_metrics に runs を加算する | 設計書に記載なし。実装の値（防御の分岐） |
| TC-UT_RUN-012 | closeFailed | 正常系 | 分岐網羅 | lastOutput が null なら output_text を上書きしない | 一時 DB（createTestDb）、FakeClock 2026-10-22T09:00:00.000Z、output_text='前の出力' の生成イベント | lastOutput=null | failed・server_error、output_text='前の出力' | B4-F | なし | なし（DEV は出力ありだけ） |  | TC-UT_RUN-012 closeFailed は lastOutput が null なら output_text を上書きしない |  |
| TC-UT_RUN-013 | generateAndValidate | 正常系 | 分岐網羅 | 設定が DB にも ctx にも無ければ、既定のモデル・出力の上限 300 で呼び、ハンドルを DB から読む | 一時 DB（createTestDb）、FakeClock 2026-10-22T09:00:00.000Z、world_settings の無い世界 | settings・validationContext・handle なし、cycleNo=7 | none、LLM の要求 modelId=@cf/google/gemma-4-26b-a4b-it・maxTokens=300・fixtureKey {zen, 7} | B5-F, B6-F, B7-T, B8-F | LLM の差し替え（要求を残す） | なし |  | TC-UT_RUN-013 generateAndValidate は設定が DB にも ctx にも無ければ、既定のモデル・出力の上限 300 で呼び、ハンドルを DB から読む | 設計書に記載なし。実装の値（world_settings の既定値と同じ） |
| TC-UT_RUN-014 | generateAndValidate | 正常系 | 分岐網羅 | ctx の settings・validationContext・handle を渡されたら、それを使い DB の文脈を読まない | 一時 DB（createTestDb）、FakeClock 2026-10-22T09:00:00.000Z、エージェントを停止しておく | settings {qwen3, 150}、validationContext、handle='given_handle' | none、要求 modelId=@cf/qwen/qwen3-30b-a3b-fp8・maxTokens=150・handle=given_handle（停止中でも例外にならない） | B5-T, B6-T, B7-F, B8-F | LLM の差し替え（要求を残す） | なし |  | TC-UT_RUN-014 generateAndValidate は ctx の settings・validationContext・handle を渡されたら、それを使い DB の文脈を読まない |  |
| TC-UT_RUN-015 | generateAndValidate | 正常系 | 分岐網羅 | validationContext だけ渡されハンドルが無ければ、エージェントからハンドルを読む | 一時 DB（createTestDb）、FakeClock 2026-10-22T09:00:00.000Z | validationContext のみ | 要求の fixtureKey.handle=minato | B7-F, B8-T | LLM の差し替え（要求を残す） | なし |  | TC-UT_RUN-015 generateAndValidate は validationContext だけ渡されてハンドルが無ければ、エージェントからハンドルを読む |  |
| TC-UT_RUN-016 | generateAndValidate | 異常系 | 分岐網羅 | world_settings が無いとき ctx.settings の上限で待ちの後の停止を判定する | 一時 DB（createTestDb）、FakeClock 2026-10-22T09:00:00.000Z、world_settings の無い世界 | timeout、settings の runs 上限 1 | StoppedError、呼び出し 1 回 | B6-T | FakeClock 2026-10-22T09:00:00.000Z、LLM の差し替え | なし |  | TC-UT_RUN-016 generateAndValidate は world_settings が無いとき ctx.settings の上限で待ちの後の停止を判定する |  |
| TC-UT_RUN-017 | runOpportunity / generateAndValidate | 正常系 | 同値分割 | 不正な形式の試行で使った Neurons も、daily_usage・生成イベント・戻り値の neurons に入る | 一時 DB（createTestDb）、FakeClock 2026-10-22T09:00:00.000Z | 不正な出力（Neurons 4）・post（Neurons 7） | succeeded、neurons=11、生成イベント 11、daily_usage calls=2・runs=1・Neurons 11 | B9-T, B10-T | LLM の差し替え | なし（DEV-18 は 1 回目を 0 とする） | 不正な形式の試行の Neurons が 0 で記録される（疑い 1） | TC-UT_RUN-017 不正な形式の試行で使った Neurons も、daily_usage・生成イベント・戻り値の neurons に入る |  |
| TC-UT_RUN-018 | runOpportunity / generateAndValidate | 正常系 | 状態遷移 | 1 回目が不正な形式のとき、その呼び出し中に stopSignal が abort されていても再生成を 1 回呼ぶ | 一時 DB（createTestDb）、FakeClock 2026-10-22T09:00:00.000Z | 呼び出し中に stopSignal を abort して不正な出力・post | 呼び出し 2 回、succeeded・post | B10-T | LLM の差し替え | なし |  | TC-UT_RUN-018 1 回目が不正な形式のとき、その呼び出し中に stopSignal が abort されていても再生成を 1 回呼ぶ | 確認事項 1。設計書に記載なし。実装の値 |
| TC-UT_RUN-019 | runOpportunity | 異常系 | エラー処理 | 再生成の側で 3036 になったら free_tier で閉じて投げ直し、1 回目の出力を残す | 一時 DB（createTestDb）、FakeClock 2026-10-22T09:00:00.000Z | 不正な出力・FreeTierExceededError | 例外、failed・free_tier、output_text は 1 回目、試行 invalid_format・free_tier | B18-T, B4-T | LLM の差し替え | 一部 TC-NOUS63_DEV-21（1 回目の 3036 だけ） |  | TC-UT_RUN-019 再生成の側で 3036 になったら free_tier で閉じて投げ直し、output_text に 1 回目の出力を残す |  |
| TC-UT_RUN-020 | runOpportunity | 異常系 | 状態遷移 | 再試行の待ちの途中で signal と stopSignal の両方が abort されたら、緊急停止を優先して cancelled（cancelled）で閉じる | 一時 DB（createTestDb）、FakeClock 2026-10-22T09:00:00.000Z | timeout の後、待ち中に stopSignal・signal の順に abort | cancelled・cancelled | B19-T | FakeClock 2026-10-22T09:00:00.000Z、LLM の差し替え | 一部 TC-NOUS83_DEV-02（waitOrStop の単体だけ） |  | TC-UT_RUN-020 再試行の待ちの途中で signal と stopSignal の両方が abort されたら、緊急停止を優先して cancelled（cancelled）で閉じる | NOUS-83 の決定：両方なら signal を優先 |

## 3. 確認事項・バグの疑い

- 疑い 1：不正な形式の試行は LLM が応答しており Neurons を消費しているが、トークン・Neurons を 0 で記録している。daily_usage.neurons が実際の消費より少なくなり、日次上限の判定が甘くなる。runOpportunity の通しでも、不正な形式の後に再生成で成功したとき daily_usage.neurons・生成イベントの neurons・戻り値の neurons に 1 回目の分が入らない。TC-UT_RUN-017 は設計どおりの期待結果で書いた（実施で NG になる見込み）。TC-NOUS63_DEV-18 は 1 回目の Neurons 0 を期待しており、疑いと食い違う
- 確認事項 1：不正な形式の後の再生成の前には shouldContinue・stopSignal を見ないため、一時停止・上限停止の指示の後でも再生成を 1 回呼ぶ（TC-UT_RUN-018 は実装の値）。1 回の呼び出しは最大 60 秒なので AC-P06（60 秒以内）は満たすが、待ちの打ち切りと同じく再生成も止めるかを決めてほしい
- 確認事項 2：00:00 UTC をまたいで再試行したとき、試行は呼んだ日の daily_usage に、指標は生成イベントの日の daily_metrics に入る（TC-UT_RUN-009）。設計書に記載がないため実装の値で書いた。Cloudflare の日次の枠が 00:00 UTC で切り替わるのとは合っている
- 確認事項 3：TC-NOUS63_DEV-23 は名前に「イベント作成後の AgentNotActiveError」とあるが、実際には closeCancelled などを直接呼んでおり、その経路は通っていない。TC-UT_RUN-006 で補った
- 確認事項 4：TC-NOUS63_DEV-23・24、TC-NOUS83_DEV-07 は runOpportunity を呼んだ直後に clock.advance するため、sleep が張られる前に時刻が進む可能性がある。実施のときに落ちたら、テストの書き方の問題として切り分ける
- 分岐 B12 の偽（DuplicateActionError で outputText が null）と B17 の真（runOpportunity の中で commitAction が failed）は単体テストでは通さない。行動の検証（validateAction）がいいね済み・フォロー済みを先に弾くため、同時に 2 つ走ったときにしか起きない。commitAction の DuplicateActionError は TC-NOUS63_DEV-20 で直接確かめている
- 分岐 B25 の真（promptsDir あり）は単体テストでは通さない。テスト用の上書きの引数で、プロンプトの組み立ては NOUS-102（PRM）の範囲で見るため
