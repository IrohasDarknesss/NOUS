# 単体テスト観点表：試行の記録と利用量の加算（generation/usageRecorder.ts）

| 項目 | 内容 |
|---|---|
| 関連チケット | NOUS-104 |
| 作成者 | Takaya Ishikawa（開発担当） |
| 作成日 | 2026-10-23 |
| 対象 | apps/server/src/generation/usageRecorder.ts |
| 言語 / フレームワーク | TypeScript / Vitest 2.1.9（environment: node） |
| テストファイル | apps/server/src/generation/usageRecorder.test.ts（実装時、NOUS-63）, apps/server/src/generation/usageRecorder.ut.test.ts（単体テストで追加） |
| 外部依存 | DB（generation_attempts・daily_usage・daily_metrics・generation_events）, ULID（newUlid） |
| 入力にした設計書 | BE 詳細設計 generation 3章 addDailyUsage・addDailyMetrics・4章 recordAttempt・6章 トランザクション, DB 物理設計書 generation_attempts・daily_usage・daily_metrics |

このファイルは `docs/test/unit/_build/build_matrix.py` で JSON から作る。直すときは JSON を直して作り直す。

## 1. 分岐の一覧

| ID | 条件 | 場所 |
|---|---|---|
| B1 | clipErrorDetail：detail == null | usageRecorder.ts:57 |
| B2 | clipErrorDetail：500 コードポイント以下 | usageRecorder.ts:59 |
| B3 | addDailyUsage：input.runs が渡されている（偽なら isFirstOfEvent で 1 か 0） | usageRecorder.ts:67 |
| B4 | addDailyUsage：トークン・Neurons が渡されている（偽なら 0） | usageRecorder.ts:68-70 |
| B5 | addDailyMetrics：列の値が undefined でない | usageRecorder.ts:106 |
| B6 | addDailyMetrics：加算する列が 0 個 | usageRecorder.ts:112 |
| B7 | metricsForSucceededAction：行動の種類（6 通り） | usageRecorder.ts:131-142 |
| B8 | recordAttempt：result が ok | usageRecorder.ts:154 |
| B9 | recordAttempt：isFirstOfEvent が渡されている（偽なら attemptNo === 1） | usageRecorder.ts:158 |
| B10 | recordAttempt：所要時間が負（0 にする） | usageRecorder.ts:160 |

## 2. ケースの一覧（19 件。うち新しく足したもの 13 件）

| ID | 対象 | 分類 | 技法 | 観点 | 前提 | 入力 | 期待結果 | 分岐 | モック | 既存テストとの対応 | バグの疑い | テスト名 | 備考 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| TC-NOUS63_DEV-01 | recordAttempt | 正常系 | 開発者テスト | ok の 1 回目は試行・daily_usage・生成イベントを 1 トランザクションで更新する | 一時 DB（createTestDb） | result=ok、attemptNo=1 | 試行 1 件、daily_usage calls=1・runs=1、生成イベントの合計 | B8-T, B9-F | なし | 実装時のテスト（NOUS-63） |  | TC-NOUS63_DEV-01 recordAttempt（ok・1回目）は generation_attempts・daily_usage・generation_events を 1 トランザクションで更新する |  |
| TC-NOUS63_DEV-02 | recordAttempt | 正常系 | 開発者テスト | 失敗の試行はトークン・Neurons を 0、2 回目以降は runs を加算しない | 一時 DB（createTestDb） | timeout・invalid_format・ok | calls=3・runs=1、トークン・Neurons は ok の分だけ | B8-F, B9-F | なし | 実装時のテスト（NOUS-63） | invalid_format の試行のトークン・Neurons を 0 とする期待値が、疑い 1 と食い違う | TC-NOUS63_DEV-02 失敗の試行はトークン・neurons を 0 で記録し、2 回目以降の試行では daily_usage.runs を増やさない |  |
| TC-NOUS63_DEV-03 | clipErrorDetail / recordAttempt | 異常系 | 開発者テスト | error_detail を 500 コードポイントまでに切る | 一時 DB（createTestDb） | 650 字の日本語、null | 500 字、null | B1-T, B2-F | なし | 実装時のテスト（NOUS-63） |  | TC-NOUS63_DEV-03 clipErrorDetail と recordAttempt は error_detail を 500 コードポイントまでに切り詰める |  |
| TC-NOUS63_DEV-04 | addDailyUsage | 正常系 | 開発者テスト | 複数のイベントにわたり calls と runs を積み上げる | 一時 DB（createTestDb） | isFirstOfEvent true・false・true | calls=3・runs=2、トークン・Neurons の合計 | B3-F, B4-T | なし | 実装時のテスト（NOUS-63） |  | TC-NOUS63_DEV-04 addDailyUsage は複数イベントにわたり calls と runs を正しく積み上げる |  |
| TC-NOUS63_DEV-05 | addDailyMetrics | 正常系 | 開発者テスト | 渡された列だけを加算し、他の列を保つ | 一時 DB（createTestDb） | 6 回の加算 | 各列の合計 | B5-T, B5-F, B6-F | なし | 実装時のテスト（NOUS-63） |  | TC-NOUS63_DEV-05 addDailyMetrics は渡された列だけを加算し、他の列を維持する |  |
| TC-NOUS63_DEV-06 | metricsForSucceededAction | 正常系 | 開発者テスト | 行動ごとの daily_metrics の加算値 | なし | post・reply・like・follow・unfollow・none | 各加算値 | B7-T | なし | 実装時のテスト（NOUS-63） |  | TC-NOUS63_DEV-06 metricsForSucceededAction は行動ごとの daily_metrics 加算値を返す |  |
| TC-UT_USG-001 | clipErrorDetail | 正常系 | 境界値 | 500 字以下ならそのまま、501 字なら 500 字に切る | なし | 499・500・501 字 | 499・500・500 字 | B1-F, B2-T, B2-F | なし | 一部 TC-NOUS63_DEV-03（650 字だけ） |  | TC-UT_USG-001 clipErrorDetail は 500 字以下ならそのまま、501 字なら 500 字に切る（$length 字） |  |
| TC-UT_USG-002 | clipErrorDetail | 正常系 | 同値分割 | undefined なら null を返す | なし | undefined | null | B1-T | なし | 一部 TC-NOUS63_DEV-03（null だけ） |  | TC-UT_USG-002 clipErrorDetail は undefined なら null を返す |  |
| TC-UT_USG-003 | clipErrorDetail | 正常系 | 同値分割 | サロゲートペアの字をコードポイントで数え、字の途中で切らない | なし | 絵文字 501 字 | 絵文字 500 字 | B2-F | なし | なし（DEV-03 は BMP の字だけ） |  | TC-UT_USG-003 clipErrorDetail はサロゲートペアの字をコードポイントで数え、字の途中で切らない |  |
| TC-UT_USG-004 | addDailyMetrics | 正常系 | 分岐網羅 | 空の差分なら、行が無ければ 0 の行を作り、行があれば何も変えない | 一時 DB（createTestDb） | {} → {runs:2} → {} | 最初は 0 の行、最後は runs=2 のまま 1 行 | B5-F, B6-T | なし | なし |  | TC-UT_USG-004 addDailyMetrics は空の差分なら、行が無いときは 0 の行を作り、行があるときは何も変えない |  |
| TC-UT_USG-005 | recordAttempt | 正常系 | 分岐網羅 | isFirstOfEvent を省略すると attemptNo が 1 のときだけ runs を加算する | 一時 DB（createTestDb） | attemptNo=1・2（isFirstOfEvent なし） | runs=1・0 | B9-F | なし | 一部 TC-NOUS63_DEV-02 |  | TC-UT_USG-005 recordAttempt は isFirstOfEvent を省略すると attemptNo が 1 のときだけ runs を加算する（attemptNo=$attemptNo） |  |
| TC-UT_USG-006 | recordAttempt | 正常系 | 分岐網羅 | isFirstOfEvent を明示すると attemptNo より優先する | 一時 DB（createTestDb） | attemptNo=1 で false、attemptNo=3 で true | runs=0 → 1 | B9-T | なし | なし |  | TC-UT_USG-006 recordAttempt は isFirstOfEvent を明示すると attemptNo より優先する（1 回目で false なら runs は 0、3 回目で true なら 1） | 設計書 4章：再生成・再試行では false |
| TC-UT_USG-007 | addDailyUsage | 正常系 | 分岐網羅 | runs を直接渡すと isFirstOfEvent より優先する | 一時 DB（createTestDb） | isFirstOfEvent=true、runs=0 | calls=1・runs=0 | B3-T | なし | なし |  | TC-UT_USG-007 addDailyUsage は runs を直接渡すと isFirstOfEvent より優先する | 設計書に記載なし。実装の値 |
| TC-UT_USG-008 | addDailyUsage | 正常系 | 分岐網羅 | 入力を省略すると calls だけ 1 加算する | 一時 DB（createTestDb） | 入力なし | calls=1、runs・トークン・Neurons は 0 | B3-F, B4-F | なし | なし |  | TC-UT_USG-008 addDailyUsage は入力を省略すると calls だけ 1 加算し、runs・トークン・Neurons は 0 にする |  |
| TC-UT_USG-009 | recordAttempt | 異常系 | 境界値 | 所要時間が負なら 0、小数なら切り捨てて記録する | 一時 DB（createTestDb） | durationMs=-5・12.9 | duration_ms=0・12 | B10-T, B10-F | なし | なし |  | TC-UT_USG-009 recordAttempt は所要時間が負なら 0、小数なら切り捨てて記録する | DB の CHECK（duration_ms >= 0）を満たすため |
| TC-UT_USG-010 | recordAttempt | 正常系 | 同値分割 | usageDate が違えば daily_usage の別の行に加算する | 一時 DB（createTestDb） | 2026-10-22 と 2026-10-23 | 日ごとに 1 行ずつ | B8-T | なし | なし |  | TC-UT_USG-010 recordAttempt は usageDate が違えば daily_usage の別の行に加算する |  |
| TC-UT_USG-011 | recordAttempt | 異常系 | エラー処理 | 試行の INSERT が CHECK 違反（attempt_no=5）なら daily_usage と生成イベントの合計を変えない | 一時 DB（createTestDb） | attemptNo=5 | 例外、試行 0 件、daily_usage 0 件、生成イベントの合計 0 | B8-T | なし | なし |  | TC-UT_USG-011 recordAttempt は試行の INSERT が CHECK 違反（attempt_no=5）なら daily_usage と生成イベントの合計を変えない | 設計書 6章：recordAttempt は 1 トランザクション |
| TC-UT_USG-012 | recordAttempt | 正常系 | 同値分割 | 不正な形式の試行もトークンと Neurons を試行・daily_usage・生成イベントに加算する | 一時 DB（createTestDb） | result=invalid_format、トークン 600・40、Neurons 6.5 | 試行・daily_usage・生成イベントにトークン 600・40、Neurons 6.5 | B8-F | なし | なし（DEV-02 は 0 を期待） | 実装は ok 以外のトークン・Neurons を 0 にする（疑い 1） | TC-UT_USG-012 不正な形式の試行（LLM は応答している）もトークンと Neurons を試行・daily_usage・生成イベントに加算する |  |
| TC-UT_USG-013 | recordAttempt | 正常系 | 同値分割 | 同じ生成イベントの ok の試行が続けば、生成イベントのトークン・Neurons を積み上げる | 一時 DB（createTestDb） | ok を 2 回 | 生成イベント 1000・50・10 | B8-T | なし | なし |  | TC-UT_USG-013 recordAttempt は同じ生成イベントの ok の試行が続けば、生成イベントのトークン・Neurons を積み上げる |  |

## 3. 確認事項・バグの疑い

- 疑い 1：不正な形式の試行は LLM が応答しており Neurons を消費しているが、トークン・Neurons を 0 で記録している。daily_usage.neurons が実際の消費より少なくなり、日次上限の判定が甘くなる。recordAttempt は result が ok 以外のときトークン・Neurons を 0 にする。不正な形式の試行のトークン・Neurons は加算するのが仕様（2026-10-26 Kouhei Tajima の決定）。TC-UT_USG-012 は仕様の期待結果で書いた（実施で NG の見込み）。TC-NOUS63_DEV-02 は 0 を期待しており、仕様と食い違う
- 分岐 B7 の偽（6 通りのどれにも当たらない）は通せない。引数の型が ActionKind | 'none' の 6 値で、switch がすべてを返すため、型の上では到達しない（default が無いので、型を外した値なら undefined を返す）
