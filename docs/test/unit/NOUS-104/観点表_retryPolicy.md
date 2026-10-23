# 単体テスト観点表：再試行と待機・停止判定（generation/retryPolicy.ts）

| 項目 | 内容 |
|---|---|
| 関連チケット | NOUS-104 |
| 作成者 | Takaya Ishikawa（開発担当） |
| 作成日 | 2026-10-23 |
| 対象 | apps/server/src/generation/retryPolicy.ts |
| 言語 / フレームワーク | TypeScript / Vitest 2.1.9（environment: node） |
| テストファイル | apps/server/src/generation/retryPolicy.test.ts（実装時、NOUS-63・83）, apps/server/src/generation/retryPolicy.ut.test.ts（単体テストで追加） |
| 外部依存 | DB（generation_attempts・daily_usage・world_settings）, 時計（Clock.sleep・now）, LLM の呼び出し（引数の関数で差し替え）, AbortSignal（緊急停止の signal・待ちだけを打ち切る stopSignal）, ロガー |
| 入力にした設計書 | BE 詳細設計 generation 2章（外部連携のリトライ方針）・4章 callWithRetry・waitOrStop・6章, 基本設計書 概要 5章 異常系1, NOUS-83（AC-P06、一時停止・上限停止で待ちを打ち切る） |

このファイルは `docs/test/unit/_build/build_matrix.py` で JSON から作る。直すときは JSON を直して作り直す。

## 1. 分岐の一覧

| ID | 条件 | 場所 |
|---|---|---|
| B1 | isCancellation：signal?.aborted | retryPolicy.ts:81 |
| B2 | isCancellation：時計か LLM の CancelledError | retryPolicy.ts:82 |
| B3 | waitOrStop：待つ前に signal.aborted | retryPolicy.ts:94 |
| B4 | waitOrStop：待つ前に stopSignal?.aborted | retryPolicy.ts:97 |
| B5 | waitOrStop：stopSignal があれば AbortSignal.any で合成 | retryPolicy.ts:101 |
| B6 | waitOrStop：sleep の失敗で signal.aborted | retryPolicy.ts:106 |
| B7 | waitOrStop：sleep の失敗で stopSignal?.aborted（偽ならそのまま投げる） | retryPolicy.ts:109-112 |
| B8 | waitOrStop：待った後に signal.aborted | retryPolicy.ts:115 |
| B9 | waitOrStop：待った後に stopSignal?.aborted | retryPolicy.ts:118 |
| B10 | loadLimitsSettings：world_settings の行がある（偽なら fallback ?? null） | retryPolicy.ts:125-126 |
| B11 | toTemporaryFailureKind：timeout か rate_limited（偽なら server_error） | retryPolicy.ts:130 |
| B12 | callWithRetry：attemptNo > 4 | retryPolicy.ts:146 |
| B13 | 呼ぶ前に signal.aborted | retryPolicy.ts:151 |
| B14 | 成功の後に signal.aborted | retryPolicy.ts:161 |
| B15 | 失敗が取り消し（isCancellation） | retryPolicy.ts:173 |
| B16 | 取り消しの例外の型がそのまま CancelledError（偽なら ClockCancelledError に変える） | retryPolicy.ts:183 |
| B17 | !isLlmError(err) | retryPolicy.ts:189 |
| B18 | FreeTierExceededError（3036） | retryPolicy.ts:214 |
| B19 | !err.retryable（400・401・invalid_format） | retryPolicy.ts:220 |
| B20 | 最後の再試行か、試行が 4 に達した | retryPolicy.ts:230 |
| B21 | 上限の設定がある（偽なら上限を見ない） | retryPolicy.ts:243 |
| B22 | !shouldContinue() \|\| !withinLimits | retryPolicy.ts:245 |

## 2. ケースの一覧（36 件。うち新しく足したもの 23 件）

| ID | 対象 | 分類 | 技法 | 観点 | 前提 | 入力 | 期待結果 | 分岐 | モック | 既存テストとの対応 | バグの疑い | テスト名 | 備考 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| TC-NOUS63_DEV-07 | waitOrStop | 正常系 | 開発者テスト | 指定ミリ秒だけ待ち、待ち中の signal の abort で CancelledError | FakeClock 2026-10-22T09:00:00.000Z | 30,000 ミリ秒 | resolve／CancelledError | B3-F, B4-F, B6-T, B8-F, B9-F | FakeClock 2026-10-22T09:00:00.000Z | 実装時のテスト（NOUS-63） |  | TC-NOUS63_DEV-07 waitOrStop は指定ミリ秒だけ待ち、abort されたら CancelledError を投げる |  |
| TC-NOUS63_DEV-08 | callWithRetry | 正常系 | 開発者テスト | 1 回目で成功したら試行を記録せず attemptNo=1 を返す | 一時 DB（createTestDb）、FakeClock 2026-10-22T09:00:00.000Z | 成功を返す呼び出し | attemptNo=1、startedAt・usageDate、generation_attempts は 0 件 | B12-F, B13-F, B14-F | 呼び出しの関数 | 実装時のテスト（NOUS-63） |  | TC-NOUS63_DEV-08 callWithRetry は 1 回目で成功したとき試行を記録せず結果と attemptNo=1 を返す |  |
| TC-NOUS63_DEV-09 | callWithRetry | 正常系 | 開発者テスト | timeout→429(3040)→成功。30 秒・120 秒の順に待ち attemptNo=3 | 一時 DB（createTestDb）、FakeClock 2026-10-22T09:00:00.000Z | 3 回目で成功する呼び出し | attemptNo=3、試行 2 件（timeout・rate_limited）、daily_usage calls=2・runs=1 | B11-T, B15-F, B17-F, B18-F, B19-F, B20-F, B21-T, B22-F | 呼び出しの関数 | 実装時のテスト（NOUS-63） |  | TC-NOUS63_DEV-09 一時的な失敗は 30 秒・120 秒の順に待ち、3 回目で成功すれば attemptNo=3 を返す | 確認事項 3 |
| TC-NOUS63_DEV-10 | callWithRetry | 異常系 | 開発者テスト | 3 回目も一時的な失敗なら最後の種類の TemporaryFailureError | 一時 DB（createTestDb）、FakeClock 2026-10-22T09:00:00.000Z | timeout・429・503 | TemporaryFailureError（server_error）、試行 3 件 | B11-F, B20-T | 呼び出しの関数 | 実装時のテスト（NOUS-63） |  | TC-NOUS63_DEV-10 3 回目も一時的な失敗なら記録して最後の失敗種別の TemporaryFailureError を投げる | 確認事項 3 |
| TC-NOUS63_DEV-11 | callWithRetry | 異常系 | 開発者テスト | 3036 と 401 は再試行せずに投げる | 一時 DB（createTestDb）、FakeClock 2026-10-22T09:00:00.000Z | FreeTierExceededError／ServerError(401) | FreeTierExceededError／TemporaryFailureError（server_error、401） | B18-T, B19-T | 呼び出しの関数 | 実装時のテスト（NOUS-63） |  | TC-NOUS63_DEV-11 FreeTierExceededError と 400/401 の ServerError は再試行せずに即座に投げる |  |
| TC-NOUS63_DEV-12 | callWithRetry | 異常系 | 開発者テスト | 待ちの後に shouldContinue=false か日次上限で StoppedError | 一時 DB（createTestDb）、FakeClock 2026-10-22T09:00:00.000Z、runs 上限 1 の世界 | timeout／429 | StoppedError | B10-T, B22-T | 呼び出しの関数 | 実装時のテスト（NOUS-63） |  | TC-NOUS63_DEV-12 再試行の待ちの後に shouldContinue() が false または日次上限到達なら StoppedError を投げる | 確認事項 1・3 |
| TC-NOUS63_DEV-13 | callWithRetry | 異常系 | 開発者テスト | 試行番号が 4 なら 1 回だけ、5 なら呼ばずに TemporaryFailureError | 一時 DB（createTestDb）、FakeClock 2026-10-22T09:00:00.000Z | startAttemptNo=4・5 | 4：試行 1 件で timeout、5：呼ばない | B12-T, B12-F, B20-T | 呼び出しの関数 | 実装時のテスト（NOUS-63） |  | TC-NOUS63_DEV-13 1 つの生成イベントの試行番号が上限 4 に達したら再試行せず TemporaryFailureError にする |  |
| TC-NOUS63_DEV-14 | callWithRetry | 異常系 | 開発者テスト | LLM の CancelledError は cancelled を記録して投げ直す | 一時 DB（createTestDb）、FakeClock 2026-10-22T09:00:00.000Z | LlmCancelledError | LlmCancelledError、試行 cancelled | B15-T, B16-T | 呼び出しの関数 | 実装時のテスト（NOUS-63） |  | TC-NOUS63_DEV-14 LLM の CancelledError または signal.aborted のときは cancelled で記録して投げ直す |  |
| TC-NOUS83_DEV-01 | waitOrStop | 異常系 | 開発者テスト | 待つ前・待ち中の stopSignal で StoppedError | FakeClock 2026-10-22T09:00:00.000Z | stopSignal を abort | StoppedError | B4-T, B5-T, B7-T | FakeClock 2026-10-22T09:00:00.000Z | 実装時のテスト（NOUS-83） |  | TC-NOUS83_DEV-01 waitOrStop は待機前または待機中に stopSignal が abort されたら StoppedError を投げる |  |
| TC-NOUS83_DEV-02 | waitOrStop | 異常系 | 開発者テスト | signal と stopSignal の両方なら signal を優先 | FakeClock 2026-10-22T09:00:00.000Z | 両方を abort | CancelledError | B3-T, B6-T | FakeClock 2026-10-22T09:00:00.000Z | 実装時のテスト（NOUS-83） |  | TC-NOUS83_DEV-02 waitOrStop は signal と stopSignal の両方が abort された場合は signal を優先して CancelledError を投げる |  |
| TC-NOUS83_DEV-03 | callWithRetry | 異常系 | 開発者テスト | 待ち中の stopSignal で時計を進めずに StoppedError、試行 1 件（AC-P06） | 一時 DB（createTestDb）、FakeClock 2026-10-22T09:00:00.000Z | timeout の後に stopSignal を abort | StoppedError、試行 1 件 | B5-T, B7-T | 呼び出しの関数 | 実装時のテスト（NOUS-83） |  | TC-NOUS83_DEV-03 callWithRetry は一時的な失敗の再試行待ちの途中で stopSignal が abort されたら時計を進めずに StoppedError になり試行は1件だけ記録される |  |
| TC-NOUS83_DEV-04 | callWithRetry | 正常系 | 開発者テスト | stopSignal が無ければ従来どおり待って再試行 | 一時 DB（createTestDb）、FakeClock 2026-10-22T09:00:00.000Z | timeout の後に成功 | attemptNo=2 | B5-F | 呼び出しの関数 | 実装時のテスト（NOUS-83） |  | TC-NOUS83_DEV-04 callWithRetry は stopSignal が渡されない場合は従来どおり再試行の待ちを完了して動作する | 確認事項 3 |
| TC-NOUS83_DEV-05 | callWithRetry | 正常系 | 開発者テスト | 呼び出し中の stopSignal では呼び出しの完了を待つ | 一時 DB（createTestDb）、FakeClock 2026-10-22T09:00:00.000Z | 呼び出し中に stopSignal を abort して成功 | 成功の結果を返す | B14-F | 呼び出しの関数 | 実装時のテスト（NOUS-83） |  | TC-NOUS83_DEV-05 callWithRetry は LLM 呼び出しの最中に stopSignal が abort されても呼び出し完了を待つ |  |
| TC-UT_RTY-001 | waitOrStop | 異常系 | 分岐網羅 | 待つ前に signal が abort 済みなら sleep を張らずに CancelledError | FakeClock 2026-10-22T09:00:00.000Z | abort 済みの signal、30,000 ミリ秒 | CancelledError、張られた sleep は 0 件 | B3-T | FakeClock 2026-10-22T09:00:00.000Z | 一部 TC-NOUS83_DEV-02（両方 abort のときだけ） |  | TC-UT_RTY-001 waitOrStop は待つ前に signal が abort 済みなら sleep を張らずに CancelledError を投げる |  |
| TC-UT_RTY-002 | waitOrStop | 異常系 | 依存 | sleep が abort 以外で失敗したら、その例外をそのまま投げる | なし | sleep が Error('sleep failed') で失敗する Clock | 同じ Error | B5-T, B6-F, B7-F | Clock の sleep を差し替え（reject） | なし（DEV は abort の失敗だけ） |  | TC-UT_RTY-002 waitOrStop は sleep が abort 以外の理由で失敗したら、その例外をそのまま投げる |  |
| TC-UT_RTY-003 | waitOrStop | 異常系 | 分岐網羅 | sleep が終わった時点で signal が abort されていれば CancelledError | なし | sleep の中で signal を abort して resolve する Clock | CancelledError | B8-T | Clock の sleep を差し替え | なし |  | TC-UT_RTY-003 waitOrStop は sleep が終わった時点で signal が abort されていれば CancelledError を投げる |  |
| TC-UT_RTY-004 | waitOrStop | 異常系 | 分岐網羅 | sleep が終わった時点で stopSignal が abort されていれば StoppedError | なし | sleep の中で stopSignal を abort して resolve する Clock | StoppedError | B8-F, B9-T | Clock の sleep を差し替え | なし |  | TC-UT_RTY-004 waitOrStop は sleep が終わった時点で stopSignal が abort されていれば StoppedError を投げる |  |
| TC-UT_RTY-005 | callWithRetry | 正常系 | 境界値 | 1 回目の失敗の後、29,999 ミリ秒では呼ばず 30,000 ミリ秒で 2 回目を呼ぶ | 一時 DB（createTestDb）、FakeClock 2026-10-22T09:00:00.000Z | timeout の後に成功 | 29,999：呼び出し 1 回、30,000：2 回、attemptNo=2 | B20-F, B22-F | FakeClock 2026-10-22T09:00:00.000Z、呼び出しの関数 | 一部 TC-NOUS63_DEV-09（30 秒ちょうどだけ） |  | TC-UT_RTY-005 1 回目の失敗の後は 29,999 ミリ秒では呼ばず、30,000 ミリ秒で 2 回目を呼ぶ |  |
| TC-UT_RTY-006 | callWithRetry | 正常系 | 境界値 | 2 回目の失敗の後、119,999 ミリ秒では呼ばず 120,000 ミリ秒で 3 回目を呼ぶ | 一時 DB（createTestDb）、FakeClock 2026-10-22T09:00:00.000Z | timeout・timeout の後に成功 | 119,999：呼び出し 2 回、120,000：3 回、attemptNo=3 | B20-F | FakeClock 2026-10-22T09:00:00.000Z、呼び出しの関数 | 一部 TC-NOUS63_DEV-09（120 秒ちょうどだけ） |  | TC-UT_RTY-006 2 回目の失敗の後は 119,999 ミリ秒では呼ばず、120,000 ミリ秒で 3 回目を呼ぶ |  |
| TC-UT_RTY-007 | callWithRetry | 正常系 | 同値分割 | 再試行の対象の失敗（timeout・429(3040)・500・502・503・success=false）は 30 秒待って再試行し、1 回目の試行をその種類で記録する | 一時 DB（createTestDb）、FakeClock 2026-10-22T09:00:00.000Z | 各失敗の後に成功（6 通り） | attemptNo=2、試行 1 件（result と http_status が失敗の種類のとおり） | B11-T, B11-F, B19-F, B20-F | 呼び出しの関数 | 一部 TC-NOUS63_DEV-09・10（timeout・429・503 だけ） |  | TC-UT_RTY-007 再試行の対象の失敗は 30 秒待って 2 回目を呼び、1 回目の試行をその種類で記録する | 設計書 2章：5xx はすべて server_error、success=false も server_error |
| TC-UT_RTY-008 | callWithRetry | 異常系 | 同値分割 | 400 は再試行せずに server_error の TemporaryFailureError | 一時 DB（createTestDb）、FakeClock 2026-10-22T09:00:00.000Z | ServerError(400) | TemporaryFailureError（server_error、httpStatus 400）、呼び出し 1 回、sleep なし、試行 1 件 | B19-T | 呼び出しの関数 | なし（DEV-11 は 401 だけ） |  | TC-UT_RTY-008 400 の ServerError は再試行せずに server_error の TemporaryFailureError になる |  |
| TC-UT_RTY-009 | callWithRetry | 異常系 | エラー処理 | 3036 は待たずに FreeTierExceededError を投げ、試行を free_tier で記録し daily_usage を 1 回分加算する | 一時 DB（createTestDb）、FakeClock 2026-10-22T09:00:00.000Z | FreeTierExceededError(429, code 3036) | FreeTierExceededError、呼び出し 1 回、試行 free_tier・429・code 3036、daily_usage calls=1・runs=1 | B18-T | 呼び出しの関数 | 一部 TC-NOUS63_DEV-11（記録は見ていない） |  | TC-UT_RTY-009 429・3036 は待たずに FreeTierExceededError を投げ、試行を free_tier で記録し daily_usage を 1 回分加算する |  |
| TC-UT_RTY-010 | callWithRetry | 異常系 | 分岐網羅 | LlmError でない例外は試行を記録せずにそのまま投げる | 一時 DB（createTestDb）、FakeClock 2026-10-22T09:00:00.000Z | TypeError | 同じ TypeError、試行 0 件、daily_usage 0 件 | B15-F, B17-T | 呼び出しの関数 | なし |  | TC-UT_RTY-010 LlmError でない例外は試行を記録せずにそのまま投げる |  |
| TC-UT_RTY-011 | callWithRetry | 異常系 | 分岐網羅 | 呼び出しが InvalidFormatError を投げたら再試行せず server_error の TemporaryFailureError | 一時 DB（createTestDb）、FakeClock 2026-10-22T09:00:00.000Z | InvalidFormatError | TemporaryFailureError（server_error）、呼び出し 1 回、試行 invalid_format | B11-F, B19-T | 呼び出しの関数 | なし |  | TC-UT_RTY-011 呼び出しが InvalidFormatError を投げたら再試行せず、server_error の TemporaryFailureError にする | 設計書に記載なし。実装の値（固定応答・Cloudflare の実装からは投げない防御の分岐） |
| TC-UT_RTY-012 | callWithRetry | 正常系 | 境界値 | 待ちの後、Neurons が日次上限の手前（99.9／100）なら再試行する | 一時 DB（createTestDb）、FakeClock 2026-10-22T09:00:00.000Z、Neurons 上限 100 の世界、daily_usage neurons=99.9 | timeout の後に成功 | attemptNo=2、呼び出し 2 回 | B10-T, B21-T, B22-F | 呼び出しの関数 | なし（DEV-12 は runs の上限だけ） |  | TC-UT_RTY-012 待ちの後、Neurons が日次上限の手前（上限 100 に対して 99.9）なら再試行する |  |
| TC-UT_RTY-013 | callWithRetry | 異常系 | 境界値 | 待ちの後、Neurons が日次上限ちょうど（100／100）なら呼ばずに StoppedError | 一時 DB（createTestDb）、FakeClock 2026-10-22T09:00:00.000Z、Neurons 上限 100 の世界、daily_usage neurons=100 | timeout が続く呼び出し | StoppedError、呼び出し 1 回 | B22-T | 呼び出しの関数 | なし（DEV-12 は runs の上限だけ） |  | TC-UT_RTY-013 待ちの後、Neurons が日次上限ちょうど（上限 100 に対して 100）なら呼ばずに StoppedError を投げる |  |
| TC-UT_RTY-014 | callWithRetry | 異常系 | 分岐網羅 | world_settings が無いときは ctx.settings の上限で判定し、上限なら StoppedError | 一時 DB（createTestDb）、FakeClock 2026-10-22T09:00:00.000Z、world_settings の無い世界、daily_usage runs=5 | timeout、settings={neurons 9500, runs 5} | StoppedError | B10-F, B21-T, B22-T | 呼び出しの関数 | なし |  | TC-UT_RTY-014 world_settings が無いときは ctx.settings の上限で判定し、上限に達していれば StoppedError を投げる |  |
| TC-UT_RTY-015 | callWithRetry | 正常系 | 分岐網羅 | world_settings も ctx.settings も無いときは上限を見ずに再試行する | 一時 DB（createTestDb）、FakeClock 2026-10-22T09:00:00.000Z、world_settings の無い世界、daily_usage が既定の上限を超えている | timeout の後に成功 | attemptNo=2 | B10-F, B21-F | 呼び出しの関数 | なし |  | TC-UT_RTY-015 world_settings も ctx.settings も無いときは上限を見ずに再試行する | 設計書に記載なし。実装の値（単体テスト用のフォールバック） |
| TC-UT_RTY-016 | callWithRetry | 異常系 | 境界値 | startAttemptNo=3 なら 3 回目と 4 回目の 2 回だけ呼ぶ | 一時 DB（createTestDb）、FakeClock 2026-10-22T09:00:00.000Z | 429 が続く呼び出し、startAttemptNo=3 | TemporaryFailureError（rate_limited）、呼び出し 2 回、試行 3・4、待ちは 30 秒の 1 回だけ | B12-F, B20-F, B20-T | 呼び出しの関数 | 一部 TC-NOUS63_DEV-13（4・5 だけ） |  | TC-UT_RTY-016 startAttemptNo=3 なら 3 回目と 4 回目の 2 回だけ呼び、4 回目も失敗なら TemporaryFailureError を投げる | NOUS-63 の決定：1 つの生成イベントの試行は 4 回まで |
| TC-UT_RTY-017 | callWithRetry | 異常系 | 分岐網羅 | 呼ぶ前に signal が abort 済みなら、呼ばず・記録せずに CancelledError | 一時 DB（createTestDb）、FakeClock 2026-10-22T09:00:00.000Z | abort 済みの signal | CancelledError、呼び出し 0 回、試行 0 件 | B13-T | 呼び出しの関数 | なし |  | TC-UT_RTY-017 呼ぶ前に signal が abort 済みなら、呼ばず・記録せずに CancelledError を投げる |  |
| TC-UT_RTY-018 | callWithRetry | 異常系 | 分岐網羅 | 呼び出し中に signal が abort され TimeoutError で終わったら cancelled で記録して CancelledError | 一時 DB（createTestDb）、FakeClock 2026-10-22T09:00:00.000Z | abort してから TimeoutError を投げる呼び出し | ClockCancelledError、試行 1 件（cancelled）、sleep なし | B1-T, B15-T, B16-F | 呼び出しの関数 | 一部 TC-NOUS63_DEV-14（LLM の CancelledError だけ） |  | TC-UT_RTY-018 呼び出し中に signal が abort され、呼び出しが TimeoutError で終わったら cancelled で記録して CancelledError を投げる |  |
| TC-UT_RTY-019 | callWithRetry | 異常系 | 分岐網羅 | 呼び出しが成功した直後に signal が abort されていたら CancelledError、試行は記録しない | 一時 DB（createTestDb）、FakeClock 2026-10-22T09:00:00.000Z | abort してから成功を返す呼び出し | ClockCancelledError、試行 0 件 | B14-T | 呼び出しの関数 | なし |  | TC-UT_RTY-019 呼び出しが成功した直後に signal が abort されていたら CancelledError を投げ、試行は記録しない | 確認事項 2。設計書に記載なし。実装の値 |
| TC-UT_RTY-020 | callWithRetry | 異常系 | エラー処理 | 再試行の待ちの途中で signal が abort されたら、2 回目を呼ばずに CancelledError | 一時 DB（createTestDb）、FakeClock 2026-10-22T09:00:00.000Z | timeout の後、待ち中に signal を abort | ClockCancelledError、呼び出し 1 回、試行 1 件（timeout） | B6-T | FakeClock 2026-10-22T09:00:00.000Z、呼び出しの関数 | なし（DEV は待ち中の stopSignal だけ） |  | TC-UT_RTY-020 再試行の待ちの途中で signal が abort されたら、2 回目を呼ばずに CancelledError を投げる |  |
| TC-UT_RTY-021 | callWithRetry | 異常系 | エラー処理 | 呼び出し中に stopSignal が abort され、その呼び出しが一時的な失敗なら、待たずに StoppedError（AC-P06） | 一時 DB（createTestDb）、FakeClock 2026-10-22T09:00:00.000Z | stopSignal を abort してから 429 を投げる呼び出し | StoppedError、呼び出し 1 回、時計は進まない、試行 1 件（rate_limited） | B4-T | 呼び出しの関数 | なし（DEV-83-05 は呼び出しが成功する場合だけ） |  | TC-UT_RTY-021 呼び出し中に stopSignal が abort され、その呼び出しが一時的な失敗なら、待たずに StoppedError を投げる |  |
| TC-UT_RTY-022 | callWithRetry | 正常系 | 依存 | 失敗した試行は warn のログに eventId・attemptNo・kind・httpStatus を出す | 一時 DB（createTestDb）、FakeClock 2026-10-22T09:00:00.000Z | ServerError(401) | 「LLM attempt failed」の行に eventId・server_error・401 が入る | B19-T | ロガー（sinks で行を集める） | なし |  | TC-UT_RTY-022 失敗した試行は warn のログに eventId・attemptNo・kind・httpStatus を出す | 設計書 6章：warn（実行 ID・試行の番号・HTTP の状態） |
| TC-UT_RTY-023 | isCancellation | 正常系 | 同値分割 | 取り消しの例外か signal の abort を取り消しと判定する | なし | 時計・LLM の CancelledError、abort 済みの TimeoutError、abort されていない TimeoutError | true・true・true・false | B1-T, B1-F, B2-T, B2-F | なし | なし（DEV は callWithRetry 経由だけ） |  | TC-UT_RTY-023 isCancellation は取り消しの例外か signal の abort を取り消しと判定する |  |

## 3. 確認事項・バグの疑い

- 確認事項 1：runs の上限ちょうど。この生成イベントの最初の試行で daily_usage.runs が上限に達すると、待ちの後の上限の確認で StoppedError になり、上限の中で始めた最後の 1 回が再試行できない（TC-NOUS63_DEV-12 がこの動きを期待している）。runs は「LLM を呼んだ生成イベントの数」なので、同じイベントの再試行は runs の上限で止めない方が設計の意図に近いと考える。仕様の確認を求める
- 確認事項 2：呼び出しが成功した直後に signal が abort されると、試行を記録せずに CancelledError になる（TC-UT_RTY-019）。消費した Neurons が daily_usage に入らない。緊急停止のときだけで影響は小さい。設計書に記載がないため、テストは実装の値で書いた
- 確認事項 3：TC-NOUS63_DEV-09・10・12、TC-NOUS83_DEV-04 は、callWithRetry を呼んだ直後に clock.advance するため、sleep が張られる前に時刻が進む可能性がある（FakeClock.advance は呼んだ時点のタイマーだけを解決する）。実施のときに落ちたら、テストの書き方の問題として切り分ける。UT ではタイマーが張られるのを待ってから進めている
- 分岐 B12 の真（startAttemptNo が 5 以上）は TC-NOUS63_DEV-13 で通る。opportunityRunner からは 5 以上で呼ばれることはない
