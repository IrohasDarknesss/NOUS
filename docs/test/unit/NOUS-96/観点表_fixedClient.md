# 単体テスト観点表：LLM のインタフェースと固定応答（llm/llmClient.ts・llm/fixedClient.ts）

| 項目 | 内容 |
|---|---|
| 関連チケット | NOUS-96 |
| 作成者 | Mark Zuckerberg（開発担当） |
| 作成日 | 2026-10-23 |
| 対象 | apps/server/src/llm/llmClient.ts, apps/server/src/llm/fixedClient.ts |
| 言語 / フレームワーク | TypeScript / Vitest 2.1.9（environment: node） |
| テストファイル | apps/server/src/llm/llmClient.test.ts（実装時、NOUS-47）, apps/server/src/llm/fixedClient.test.ts（実装時、NOUS-47・NOUS-76）, apps/server/src/llm/fixtureScenarios.test.ts（実装時、NOUS-73）, apps/server/src/llm/llmClient.ut.test.ts（単体テストで追加）, apps/server/src/llm/fixedClient.ut.test.ts（単体テストで追加） |
| 外部依存 | ファイル（fixtures/llm の読み込み。単体テストは mkdtemp の一時ディレクトリ）, 時計（LlmClock：now・sleep。FakeClock を渡せる）, AbortSignal（緊急停止の取り消し）, zod（固定応答の形の検証） |
| 入力にした設計書 | BE 詳細設計 generation 2章（LlmClient.generate）・4章（fixedGenerate）・6章（エラーと再試行）, テスト 固定応答シナリオ, 行動生成とプロンプトの設計 12章（固定応答） |

このファイルは `docs/test/unit/_build/build_matrix.py` で JSON から作る。直すときは JSON を直して作り直す。

## 1. 分岐の一覧

| ID | 条件 | 場所 |
|---|---|---|
| B1 | LlmError：options.cause === undefined | llmClient.ts:54 |
| B2 | LlmError：options.httpStatus ?? null（未指定・null） | llmClient.ts:56 |
| B3 | LlmError：options.detail == null | llmClient.ts:57 |
| B4 | ServerError.retryable：httpStatus が 400・401 以外 | llmClient.ts:86 |
| B5 | createLlmError：case "timeout"（偽は他の kind で通る。B6〜B10 も同じ） | llmClient.ts:113 |
| B6 | createLlmError：case "rate_limited" | llmClient.ts:115 |
| B7 | createLlmError：case "free_tier" | llmClient.ts:117 |
| B8 | createLlmError：case "server_error" | llmClient.ts:119 |
| B9 | createLlmError：case "invalid_format" | llmClient.ts:121 |
| B10 | createLlmError：case "cancelled" | llmClient.ts:123 |
| B11 | fixturePath：シナリオの名前が SCENARIO_PATTERN に合わない | fixedClient.ts:76 |
| B12 | fixturePath：ハンドルが HANDLE_PATTERN に合わない | fixedClient.ts:79 |
| B13 | fixturePath：巡の番号が整数でない、または 1 未満 | fixedClient.ts:82 |
| B14 | loadFixture：readFile が例外 | fixedClient.ts:91-98 |
| B15 | loadFixture：例外の code が ENOENT | fixedClient.ts:94 |
| B16 | loadFixture：JSON.parse が例外 | fixedClient.ts:100-104 |
| B17 | loadFixture：fixtureSchema の検証に失敗 | fixedClient.ts:106 |
| B18 | generate：呼ぶ前に signal が abort 済み | fixedClient.ts:121 |
| B19 | generate：固定応答のファイルがない（fixture === null） | fixedClient.ts:128 |
| B20 | generate：delayMs があり 0 より大きい | fixedClient.ts:139 |
| B21 | generate：clock.sleep が拒否 | fixedClient.ts:140-148 |
| B22 | generate：拒否が lib の CancelledError、または signal が abort 済み | fixedClient.ts:144 |
| B23 | generate：待ちの後に signal が abort 済み | fixedClient.ts:150 |
| B24 | generate：fixture.error がある | fixedClient.ts:154 |
| B25 | generate：fixture.text が undefined（?? で none にする） | fixedClient.ts:163 |
| B26 | generate：fixture.usage がない（?. と ?? で 0） | fixedClient.ts:164-166 |

## 2. ケースの一覧（55 件。うち新しく足したもの 27 件）

| ID | 対象 | 分類 | 技法 | 観点 | 前提 | 入力 | 期待結果 | 分岐 | モック | 既存テストとの対応 | バグの疑い | テスト名 | 備考 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| TC-NOUS47_DEV-01 | createLlmError / LlmError の各型 | 正常系 | 開発者テスト | createLlmError(kind) が対応する型・kind・再試行の可否を返す（6 種） | なし | kind = timeout・rate_limited・free_tier・server_error・invalid_format・cancelled、message "msg" | 対応する型。kind・retryable（timeout・rate_limited・server_error だけ真）・name。httpStatus と detail は null | B1-T, B2-T, B3-T, B5-T, B5-F, B6-T, B6-F, B7-T, B7-F, B8-T, B8-F, B9-T, B9-F, B10-T, B10-F | なし | 実装時のテスト（NOUS-47） |  | TC-NOUS47_DEV-01 createLlmError(%s) が対応する型・kind・再試行の可否を返す |  |
| TC-NOUS47_DEV-02 | ServerError.retryable | 正常系 | 開発者テスト | ServerError は 400・401 だけ再試行しない | なし | httpStatus 400・401・500・503・200 | 400・401 は偽、ほかは真 | B4-T, B4-F | なし | 実装時のテスト（NOUS-47） |  | TC-NOUS47_DEV-02 ServerError は 400・401 だけ再試行しない |  |
| TC-NOUS47_DEV-03 | LlmError（constructor） | 正常系 | 開発者テスト | detail は 500 字で切り詰め、httpStatus と cause を保つ | なし | RateLimitedError、httpStatus 429、detail 600 字、cause | detail 500 字、httpStatus 429、cause が同じもの | B1-F, B2-F, B3-F | なし | 実装時のテスト（NOUS-47） |  | TC-NOUS47_DEV-03 detail は 500 字で切り詰め、httpStatus と cause を保つ |  |
| TC-NOUS47_DEV-04 | isLlmError | 正常系 | 開発者テスト | isLlmError は LlmError だけを真にする | なし | TimeoutError、Error、"timeout"、null | TimeoutError だけ真 |  | なし | 実装時のテスト（NOUS-47） |  | TC-NOUS47_DEV-04 isLlmError は LlmError だけを真にする |  |
| TC-NOUS47_DEV-11 | FixedClient.generate | 正常系 | 開発者テスト | text と usage を LlmResult にして返す | fixtures/llm/basic（読むだけ） | minato・巡 1 | action post、promptTokens 1420・completionTokens 44・neurons 14.1、httpStatus 200、durationMs 0 | B18-F, B19-F, B20-F, B24-F, B26-F | 時計の差し替え（sleep を記録して時刻だけ進める） | 実装時のテスト（NOUS-47） |  | TC-NOUS47_DEV-11 text と usage を LlmResult にして返す |  |
| TC-NOUS47_DEV-12 | FixedClient.generate | 正常系 | 開発者テスト | delayMs だけ時計で待ち、durationMs に反映する | fixtures/llm/basic（読むだけ） | riko・巡 1（delayMs 1500） | sleep(1500) を 1 回、durationMs 1500、action like | B20-T, B21-F, B23-F, B24-F | 時計の差し替え（sleep を記録して時刻だけ進める） | 実装時のテスト（NOUS-47） |  | TC-NOUS47_DEV-12 delayMs だけ時計で待ち、durationMs に反映する |  |
| TC-NOUS47_DEV-13 | FixedClient.generate | 異常系 | 開発者テスト | error を書いたファイルはその失敗を起こす | fixtures/llm/basic（読むだけ） | zen・巡 1（error rate_limited） | RateLimitedError、httpStatus 429、retryable 真 | B24-T, B6-T | 時計の差し替え | 実装時のテスト（NOUS-47） |  | TC-NOUS47_DEV-13 error を書いたファイルはその失敗を起こす |  |
| TC-NOUS47_DEV-14 | FixedClient.generate | 正常系 | 開発者テスト | ファイルがなければ none の JSON を返す | fixtures/llm/basic（読むだけ） | gen・巡 99 | NONE_RESPONSE_TEXT、トークン・neurons 0、httpStatus 200 | B14-T, B15-T, B19-T | 時計の差し替え | 実装時のテスト（NOUS-47） |  | TC-NOUS47_DEV-14 ファイルがなければ none の JSON を返す |  |
| TC-NOUS47_DEV-21 | FixedClient.generate | 異常系 | 開発者テスト | error=%s を対応する例外で再現する（4 種） | mkdtemp の一時ディレクトリに s1/<ハンドル>-<巡>.json を置く | error = timeout・rate_limited・free_tier・server_error | 対応する型、kind、httpStatus（null・429・429・500）、detail "fixture:s1/aoi-1" | B20-F, B24-T, B5-T, B6-T, B7-T, B8-T | 時計の差し替え | 実装時のテスト（NOUS-47） |  | TC-NOUS47_DEV-21 error=%s を対応する例外で再現する |  |
| TC-NOUS47_DEV-22 | FixedClient.generate | 異常系 | 開発者テスト | delayMs を待ってから error を起こす | mkdtemp の一時ディレクトリに s1/<ハンドル>-<巡>.json を置く | error server_error、delayMs 8000 | sleep(8000) の後に ServerError | B20-T, B21-F, B23-F, B24-T | 時計の差し替え | 実装時のテスト（NOUS-47） |  | TC-NOUS47_DEV-22 delayMs を待ってから error を起こす |  |
| TC-NOUS47_DEV-23 | FixedClient.generate | 正常系 | 開発者テスト | 囲み付き・不正な形式の text もそのまま返す（AC-L04） | mkdtemp の一時ディレクトリに s1/<ハンドル>-<巡>.json を置く | text = ```json 囲みの文字列、usage なし | text がそのまま。トークン・neurons 0 | B24-F, B26-T | 時計の差し替え | 実装時のテスト（NOUS-47） |  | TC-NOUS47_DEV-23 囲み付き・不正な形式の text もそのまま返す（AC-L04） |  |
| TC-NOUS47_DEV-24 | FixedClient.generate | 異常系 | 開発者テスト | delayMs の待ちの間に abort されたら CancelledError | mkdtemp の一時ディレクトリに s1/<ハンドル>-<巡>.json を置く | text x、delayMs 8000。sleep の中で abort | LLM の CancelledError | B20-T, B21-T, B22-T | 時計の差し替え（sleep の中で abort し、signal.reason を投げる） | 実装時のテスト（NOUS-47） |  | TC-NOUS47_DEV-24 delayMs の待ちの間に abort されたら CancelledError |  |
| TC-NOUS47_DEV-25 | FixedClient.generate | 異常系 | 開発者テスト | 呼ぶ前に abort 済みなら CancelledError で、ファイルを読まない | なし | abort 済みの signal、ハンドル "bad/../x" | CancelledError（ハンドルの検証より先） | B18-T | 時計の差し替え | 実装時のテスト（NOUS-47） |  | TC-NOUS47_DEV-25 呼ぶ前に abort 済みなら CancelledError で、ファイルを読まない |  |
| TC-NOUS47_DEV-26 | FixedClient.generate / loadFixture | 異常系 | 開発者テスト | ファイルの形が不正なら FixtureError（JSON でない・text も error もない・error の値が不正・delayMs が負・未知の項目） | mkdtemp の一時ディレクトリに s1/<ハンドル>-<巡>.json を置く | 5 種の不正な本文 | どれも FixtureError | B16-T, B17-T | 時計の差し替え | 実装時のテスト（NOUS-47） |  | TC-NOUS47_DEV-26 ファイルの形が不正なら FixtureError |  |
| TC-NOUS47_DEV-31 | fixturePath | 正常系 | 開発者テスト | <シナリオ>/<ハンドル>-<巡>.json を組み立てる | なし | "fixtures/llm"、"basic"、{ minato, 3 } | fixtures/llm/basic/minato-3.json | B11-F, B12-F, B13-F | なし | 実装時のテスト（NOUS-47） |  | TC-NOUS47_DEV-31 <シナリオ>/<ハンドル>-<巡>.json を組み立てる |  |
| TC-NOUS47_DEV-32 | fixturePath | 異常系 | 開発者テスト | パスの外へ出る値・不正な値は FixtureError | なし | handle "../etc"・"ab"、cycleNo 0・1.5、scenario "../basic" | どれも FixtureError | B11-T, B12-T, B13-T | なし | 実装時のテスト（NOUS-47） |  | TC-NOUS47_DEV-32 パスの外へ出る値・不正な値は FixtureError |  |
| TC-NOUS76_DEV-04 | FixedClient.generate | 異常系 | 開発者テスト | 時計が lib の CancelledError で拒否したら、LLM の CancelledError（kind=cancelled）に変換する | mkdtemp の一時ディレクトリに s1/<ハンドル>-<巡>.json を置く | text x、delayMs 8000。signal は abort しない | LLM の CancelledError、kind cancelled、cause は lib の CancelledError | B21-T, B22-T | 時計の差し替え（sleep が lib の CancelledError を投げる） | 実装時のテスト（NOUS-76） |  | TC-NOUS76_DEV-04 時計が lib の CancelledError で拒否したら、LLM の CancelledError（kind=cancelled）に変換する |  |
| TC-NOUS73_DEV-01 | loadFixture / FixedClient.generate（fixtures/llm の 7 シナリオ） | 正常系 | 開発者テスト | 7 シナリオの scenario.json の種・巡の数・10 体が固定応答シナリオ.md どおり | fixtures/llm の 7 シナリオ（読むだけ） | 各シナリオのファイル | 固定応答シナリオ.md どおり | B17-F | 時計の差し替え（sleep は何もしない） | 実装時のテスト（NOUS-73） |  | TC-NOUS73_DEV-01 $name の scenario.json が種・巡の数・10 体どおり | 固定応答のデータの確認。fixedClient の分岐は読み込みの経路だけを通る |
| TC-NOUS73_DEV-02 | loadFixture / FixedClient.generate（fixtures/llm の 7 シナリオ） | 正常系 | 開発者テスト | 7 シナリオの全ファイルが loadFixture で読め、ハンドルと巡が範囲の中 | fixtures/llm の 7 シナリオ（読むだけ） | 各シナリオのファイル | 固定応答シナリオ.md どおり | B14-F, B16-F, B17-F | 時計の差し替え（sleep は何もしない） | 実装時のテスト（NOUS-73） |  | TC-NOUS73_DEV-02 $name の全ファイルが fixedClient の形で読め、ハンドルと巡が範囲の中 | 固定応答のデータの確認。fixedClient の分岐は読み込みの経路だけを通る |
| TC-NOUS73_DEV-03 | loadFixture / FixedClient.generate（fixtures/llm の 7 シナリオ） | 正常系 | 開発者テスト | 7 シナリオの行動の本文が 140 字以内で、6.1 の組み合わせに合う | fixtures/llm の 7 シナリオ（読むだけ） | 各シナリオのファイル | 固定応答シナリオ.md どおり | B17-F | 時計の差し替え（sleep は何もしない） | 実装時のテスト（NOUS-73） |  | TC-NOUS73_DEV-03 $name の行動の本文は 140 字以内で、6.1 の組み合わせに合う | 固定応答のデータの確認。fixedClient の分岐は読み込みの経路だけを通る |
| TC-NOUS73_DEV-11 | loadFixture / FixedClient.generate（fixtures/llm の 7 シナリオ） | 正常系 | 開発者テスト | basic に投稿・返信・いいね・フォロー・解除・何もしない（llm）と失敗が出る | fixtures/llm の 7 シナリオ（読むだけ） | 各シナリオのファイル | 固定応答シナリオ.md どおり | B17-F | 時計の差し替え（sleep は何もしない） | 実装時のテスト（NOUS-73） |  | TC-NOUS73_DEV-11 basic に投稿・返信・いいね・フォロー・解除・何もしない（llm）と失敗が出る | 固定応答のデータの確認。fixedClient の分岐は読み込みの経路だけを通る |
| TC-NOUS73_DEV-12 | loadFixture / FixedClient.generate（fixtures/llm の 7 シナリオ） | 正常系 | 開発者テスト | follow10 は奇数の巡でフォロー、偶数の巡で同じ相手を解除する | fixtures/llm の 7 シナリオ（読むだけ） | 各シナリオのファイル | 固定応答シナリオ.md どおり | B17-F | 時計の差し替え（sleep は何もしない） | 実装時のテスト（NOUS-73） |  | TC-NOUS73_DEV-12 follow10 は奇数の巡でフォロー、偶数の巡で同じ相手を解除する | 固定応答のデータの確認。fixedClient の分岐は読み込みの経路だけを通る |
| TC-NOUS73_DEV-13 | loadFixture / FixedClient.generate（fixtures/llm の 7 シナリオ） | 正常系 | 開発者テスト | limits は全応答が 1 回 2,000 Neurons | fixtures/llm の 7 シナリオ（読むだけ） | 各シナリオのファイル | 固定応答シナリオ.md どおり | B17-F | 時計の差し替え（sleep は何もしない） | 実装時のテスト（NOUS-73） |  | TC-NOUS73_DEV-13 limits は全応答が 1 回 2,000 Neurons | 固定応答のデータの確認。fixedClient の分岐は読み込みの経路だけを通る |
| TC-NOUS73_DEV-14 | loadFixture / FixedClient.generate（fixtures/llm の 7 シナリオ） | 正常系 | 開発者テスト | failures の巡 1 で各失敗・不正な形式・囲み・delayMs 8000 を返す | fixtures/llm の 7 シナリオ（読むだけ） | 各シナリオのファイル | 固定応答シナリオ.md どおり | B20-T, B24-T, B24-F | 時計の差し替え（sleep は何もしない） | 実装時のテスト（NOUS-73） |  | TC-NOUS73_DEV-14 failures の巡 1 で各失敗・不正な形式・囲み・delayMs 8000 を返す | 固定応答のデータの確認。fixedClient の分岐は読み込みの経路だけを通る |
| TC-NOUS73_DEV-15 | loadFixture / FixedClient.generate（fixtures/llm の 7 シナリオ） | 正常系 | 開発者テスト | injection の巡 1 に指示の混入とマークアップの本文がある | fixtures/llm の 7 シナリオ（読むだけ） | 各シナリオのファイル | 固定応答シナリオ.md どおり | B17-F | 時計の差し替え（sleep は何もしない） | 実装時のテスト（NOUS-73） |  | TC-NOUS73_DEV-15 injection の巡 1 に指示の混入とマークアップの本文がある | 固定応答のデータの確認。fixedClient の分岐は読み込みの経路だけを通る |
| TC-NOUS73_DEV-16 | loadFixture / FixedClient.generate（fixtures/llm の 7 シナリオ） | 正常系 | 開発者テスト | inconsistency に C01〜C04 の材料がそろう | fixtures/llm の 7 シナリオ（読むだけ） | 各シナリオのファイル | 固定応答シナリオ.md どおり | B17-F | 時計の差し替え（sleep は何もしない） | 実装時のテスト（NOUS-73） |  | TC-NOUS73_DEV-16 inconsistency に C01〜C04 の材料がそろう | 固定応答のデータの確認。fixedClient の分岐は読み込みの経路だけを通る |
| TC-NOUS73_DEV-17 | loadFixture / FixedClient.generate（fixtures/llm の 7 シナリオ） | 正常系 | 開発者テスト | long_run は 3 日分（216 巡）で、巡ごとに 1 体が投稿する | fixtures/llm の 7 シナリオ（読むだけ） | 各シナリオのファイル | 固定応答シナリオ.md どおり | B17-F | 時計の差し替え（sleep は何もしない） | 実装時のテスト（NOUS-73） |  | TC-NOUS73_DEV-17 long_run は 3 日分（216 巡）で、巡ごとに 1 体が投稿する | 固定応答のデータの確認。fixedClient の分岐は読み込みの経路だけを通る |
| TC-NOUS73_DEV-18 | loadFixture / FixedClient.generate（fixtures/llm の 7 シナリオ） | 正常系 | 開発者テスト | ファイルのない組み合わせは none になる | fixtures/llm の 7 シナリオ（読むだけ） | 各シナリオのファイル | 固定応答シナリオ.md どおり | B15-T, B19-T | 時計の差し替え（sleep は何もしない） | 実装時のテスト（NOUS-73） |  | TC-NOUS73_DEV-18 ファイルのない組み合わせは none になる | 固定応答のデータの確認。fixedClient の分岐は読み込みの経路だけを通る |
| TC-UT_LLM-001 | LlmError（constructor） | 正常系 | 境界値 | detail が 500 字ちょうどなら切らず、501 字なら 500 字に切る | なし | ServerError、detail "a"×500、"a"×501 | 500 字はそのまま、501 字は先頭 500 字 | B3-F | なし | 一部 TC-NOUS47_DEV-03（600 字だけ） |  | TC-UT_LLM-001 detail が 500 字ちょうどなら切らず、501 字なら 500 字に切る |  |
| TC-UT_LLM-002 | LlmError（constructor） | 正常系 | 同値分割 | detail が空文字なら null にせず空文字のまま持つ | なし | TimeoutError、detail "" | detail は "" | B3-F | なし | なし |  | TC-UT_LLM-002 detail が空文字なら null にせず空文字のまま持つ | 設計書に記載なし。実装の値（== null のときだけ null） |
| TC-UT_LLM-003 | LlmError（constructor） | 正常系 | 分岐網羅 | cause を渡さなければ cause を持たず、null を渡せば null を持つ | なし | options なし、{ cause: null } | 1 本目は "cause" in e が偽、2 本目は e.cause が null | B1-T, B1-F | なし | 一部 TC-NOUS47_DEV-03（Error を渡したときだけ） |  | TC-UT_LLM-003 cause を渡さなければ cause を持たず、null を渡せば null を持つ |  |
| TC-UT_LLM-004 | ServerError.retryable | 正常系 | 境界値 | 400・401 の隣の 399・402 は再試行し、httpStatus が null（HTTP を経ない失敗）も再試行する | なし | httpStatus 399・402・null | どれも retryable 真 | B2-T, B4-T | なし | 一部 TC-NOUS47_DEV-02（400・401・500・503・200） |  | TC-UT_LLM-004 400・401 の隣の 399・402 は再試行し、httpStatus が null も再試行する |  |
| TC-UT_LLM-005 | createLlmError | 正常系 | 同値分割 | createLlmError は options（httpStatus・detail・cause）をそのまま渡す | なし | kind server_error、{ httpStatus: 500, detail: "d", cause } | httpStatus 500、detail "d"、cause が同じもの | B1-F, B2-F, B3-F, B8-T | なし | なし（DEV-01 は message だけ） |  | TC-UT_LLM-005 createLlmError は options（httpStatus・detail・cause）をそのまま渡す |  |
| TC-UT_LLM-006 | fixturePath | 正常系 | 境界値 | ハンドルは 3 字と 20 字なら受け付ける | なし | handle "abc"・"a"×20、scenario "basic"、cycleNo 1 | basic/abc-1.json、basic/aaaa…(20 字)-1.json | B11-F, B12-F, B13-F | なし | なし（DEV-32 は 2 字の拒否だけ） |  | TC-UT_LLM-006 ハンドルは 3 字と 20 字なら受け付ける |  |
| TC-UT_LLM-007 | fixturePath | 異常系 | 境界値 | ハンドルが 21 字なら FixtureError | なし | handle "a"×21 | FixtureError | B11-F, B12-T | なし | なし |  | TC-UT_LLM-007 ハンドルが 21 字なら FixtureError |  |
| TC-UT_LLM-008 | fixturePath | 異常系 | 同値分割 | ハンドルにハイフンを含むと FixtureError（ファイル名の区切りと紛れるため） | なし | handle "min-ato" | FixtureError | B11-F, B12-T | なし | なし |  | TC-UT_LLM-008 ハンドルにハイフンを含むと FixtureError |  |
| TC-UT_LLM-009 | fixturePath | 正常系 | 境界値 | シナリオの名前は 1 字・40 字・ハイフン入りなら受け付ける | なし | scenario "a"・"s"×40・"long-run" | どれもパスを返す | B11-F, B12-F, B13-F | なし | なし |  | TC-UT_LLM-009 シナリオの名前は 1 字・40 字・ハイフン入りなら受け付ける |  |
| TC-UT_LLM-010 | fixturePath | 異常系 | 境界値 | シナリオの名前が空か 41 字なら FixtureError | なし | scenario ""・"s"×41 | どちらも FixtureError | B11-T | なし | なし（DEV-32 は "../basic" だけ） |  | TC-UT_LLM-010 シナリオの名前が空か 41 字なら FixtureError |  |
| TC-UT_LLM-011 | fixturePath | 正常系 | 境界値 | 巡の番号は 1 なら受け付ける | なし | cycleNo 1 | minato-1.json | B13-F | なし | なし（DEV-31 は 3） |  | TC-UT_LLM-011 巡の番号は 1 なら受け付ける |  |
| TC-UT_LLM-012 | fixturePath | 異常系 | 同値分割 | 巡の番号が NaN・Infinity・負なら FixtureError | なし | cycleNo NaN・Infinity・-1 | どれも FixtureError | B13-T | なし | なし（DEV-32 は 0 と 1.5） |  | TC-UT_LLM-012 巡の番号が NaN・Infinity・負なら FixtureError |  |
| TC-UT_LLM-013 | loadFixture | 異常系 | エラー処理 | ファイルの場所がディレクトリなど、ENOENT 以外で読めなければ FixtureError（null にしない） | mkdtemp の一時ディレクトリに s1/<ハンドル>-<巡>.json を置く（s1/aoi-1.json という名前のディレクトリを作る） | loadFixture(<一時ディレクトリ>/s1/aoi-1.json) | FixtureError、cause に元の例外（EISDIR） | B14-T, B15-F | なし | なし |  | TC-UT_LLM-013 ENOENT 以外で読めなければ FixtureError（null にしない） |  |
| TC-UT_LLM-014 | FixedClient.generate | 異常系 | エラー処理 | ハンドルが不正なら FixtureError を投げ、LlmError にはしない | なし | abort していない signal、handle "../etc" | FixtureError。isLlmError は偽 | B18-F, B12-T | 時計の差し替え | なし（DEV-32 は fixturePath を直接呼ぶ。DEV-25 は abort が先） |  | TC-UT_LLM-014 ハンドルが不正なら FixtureError を投げ、LlmError にはしない |  |
| TC-UT_LLM-015 | FixedClient.generate | 異常系 | 分岐網羅 | text と error の両方があるファイルは error の失敗を起こす | mkdtemp の一時ディレクトリに s1/<ハンドル>-<巡>.json を置く | { text: "x", error: "timeout" } | TimeoutError（text は返さない） | B20-F, B24-T, B5-T | 時計の差し替え | なし |  | TC-UT_LLM-015 text と error の両方があるファイルは error の失敗を起こす | 設計書（generation 4章 fixedGenerate）の手順 4（error があれば対応する例外）が手順 5 より先 |
| TC-UT_LLM-016 | FixedClient.generate | 正常系 | 境界値 | delayMs が 0 なら時計の sleep を呼ばない | mkdtemp の一時ディレクトリに s1/<ハンドル>-<巡>.json を置く | { text: "x", delayMs: 0 } | sleep を呼ばない。durationMs 0 | B20-F, B23-F, B24-F | 時計の差し替え（sleep の呼び出しを記録） | なし |  | TC-UT_LLM-016 delayMs が 0 なら時計の sleep を呼ばない |  |
| TC-UT_LLM-017 | FixedClient.generate | 正常系 | 境界値 | delayMs が 1 なら 1 ms だけ sleep する | mkdtemp の一時ディレクトリに s1/<ハンドル>-<巡>.json を置く | { text: "x", delayMs: 1 } | sleep(1) を 1 回。durationMs 1 | B20-T, B21-F, B23-F | 時計の差し替え（sleep を記録して時刻だけ進める） | なし（DEV-12 は 1500） |  | TC-UT_LLM-017 delayMs が 1 なら 1 ms だけ sleep する |  |
| TC-UT_LLM-018 | FixedClient.generate | 異常系 | 分岐網羅 | 時計の sleep が取り消し以外で失敗し、signal も abort されていなければ、その例外をそのまま投げる | mkdtemp の一時ディレクトリに s1/<ハンドル>-<巡>.json を置く | { text: "x", delayMs: 10 }、abort していない signal | sleep が投げた Error（同じもの）。CancelledError にしない | B20-T, B21-T, B22-F | 時計の差し替え（sleep が new Error("clock broken") を投げる） | なし |  | TC-UT_LLM-018 時計の sleep が取り消し以外で失敗し、signal も abort されていなければ、その例外をそのまま投げる |  |
| TC-UT_LLM-019 | FixedClient.generate | 異常系 | 分岐網羅 | sleep が終わった時点で abort されていたら CancelledError（cause は signal.reason） | mkdtemp の一時ディレクトリに s1/<ハンドル>-<巡>.json を置く | { text: "x", delayMs: 10 } | LLM の CancelledError、cause は abort の理由 | B20-T, B21-F, B23-T | 時計の差し替え（sleep の中で abort し、正常に返す） | なし（DEV-24 は sleep が拒否する場合） |  | TC-UT_LLM-019 sleep が終わった時点で abort されていたら CancelledError |  |
| TC-UT_LLM-020 | FixedClient.generate | 正常系 | 依存 | FakeClock を渡すと、時計を進めるまで応答を返さず、durationMs は進めた時間になる | mkdtemp の一時ディレクトリに s1/<ハンドル>-<巡>.json を置く。FakeClock 2026-10-22T09:00:00.000Z | { text: "x", delayMs: 8000 } | advance(7999) までは未解決、advance(1) で解決。durationMs 8000 | B20-T, B21-F, B23-F, B24-F | FakeClock 2026-10-22T09:00:00.000Z | なし（DEV は時計の差し替えで、FakeClock は使っていない） |  | TC-UT_LLM-020 FakeClock を渡すと、時計を進めるまで応答を返さず、durationMs は進めた時間になる |  |
| TC-UT_LLM-021 | FixedClient.generate | 異常系 | 依存 | FakeClock で待っている間に abort したら CancelledError | mkdtemp の一時ディレクトリに s1/<ハンドル>-<巡>.json を置く。FakeClock 2026-10-22T09:00:00.000Z | { text: "x", delayMs: 8000 }、待ちの途中で abort | LLM の CancelledError。FakeClock の pendingCount 0 | B20-T, B21-T, B22-T | FakeClock 2026-10-22T09:00:00.000Z | 一部 TC-NOUS47_DEV-24（差し替えの時計で、FakeClock の取り消しは見ていない） |  | TC-UT_LLM-021 FakeClock で待っている間に abort したら CancelledError |  |
| TC-UT_LLM-022 | loadFixture（fixtureSchema） | 異常系 | 同値分割 | usage の項目が 1 つでも欠けたら FixtureError | mkdtemp の一時ディレクトリに s1/<ハンドル>-<巡>.json を置く | { text: "x", usage: { prompt_tokens: 1, completion_tokens: 1 } } | FixtureError | B17-T | なし | なし |  | TC-UT_LLM-022 usage の項目が 1 つでも欠けたら FixtureError |  |
| TC-UT_LLM-023 | loadFixture（fixtureSchema） | 正常系 | 境界値 | usage のトークンと neurons が 0 なら受け付ける | mkdtemp の一時ディレクトリに s1/<ハンドル>-<巡>.json を置く | { text: "x", usage: { prompt_tokens: 0, completion_tokens: 0, neurons: 0 } } | 読める。値は 0 | B17-F | なし | なし |  | TC-UT_LLM-023 usage のトークンと neurons が 0 なら受け付ける |  |
| TC-UT_LLM-024 | loadFixture（fixtureSchema） | 異常系 | 境界値 | usage のトークンが -1 なら FixtureError | mkdtemp の一時ディレクトリに s1/<ハンドル>-<巡>.json を置く | { text: "x", usage: { prompt_tokens: -1, completion_tokens: 0, neurons: 0 } } | FixtureError | B17-T | なし | なし |  | TC-UT_LLM-024 usage のトークンが -1 なら FixtureError |  |
| TC-UT_LLM-025 | loadFixture（fixtureSchema） | 異常系 | 同値分割 | トークン数と delayMs が整数でなければ FixtureError | mkdtemp の一時ディレクトリに s1/<ハンドル>-<巡>.json を置く | prompt_tokens 1.5、delayMs 1.5 | どちらも FixtureError | B17-T | なし | なし（DEV-26 は delayMs の負だけ） |  | TC-UT_LLM-025 トークン数と delayMs が整数でなければ FixtureError |  |
| TC-UT_LLM-026 | FixedClient.generate | 正常系 | 同値分割 | text が空文字なら none にせず空文字を返す | mkdtemp の一時ディレクトリに s1/<ハンドル>-<巡>.json を置く | { text: "" } | text は ""、httpStatus 200 | B24-F, B25-F | 時計の差し替え | なし |  | TC-UT_LLM-026 text が空文字なら none にせず空文字を返す | 空の応答を行動の検証（outputParser）で不正な形式として扱うため、none に置き換えないのが正しい |
| TC-UT_LLM-027 | FixedClient.generate | 異常系 | 同値分割 | 固定応答の free_tier は再試行せず、rate_limited と server_error は再試行の対象になる | mkdtemp の一時ディレクトリに s1/<ハンドル>-<巡>.json を置く | error free_tier・rate_limited・server_error・timeout | retryable は free_tier だけ偽 | B24-T, B5-T, B6-T, B7-T, B8-T | 時計の差し替え | 一部 TC-NOUS47_DEV-21（型・kind・httpStatus だけ。retryable は見ていない） |  | TC-UT_LLM-027 固定応答の free_tier は再試行せず、rate_limited と server_error は再試行の対象になる |  |

## 3. 確認事項・バグの疑い

- 確認事項 1：B25 の真（text も error もないのに返す）は、fixtureSchema の refine で「text か error のどちらかが必要」と検証済みのため通らない。守りの分岐として扱い、ケースは作らない（偽は TC-UT_LLM-026 などで通る）。
- 確認事項 2：ハンドルや巡の番号が不正なときの FixtureError は LlmError ではないため、行動生成（runOpportunity・retryPolicy）の再試行や失敗の記録の対象外になる。実装時のコメントのとおり「試験の準備の誤り」として扱う設計と読み取れるので、バグの疑いではなく確認事項とする（行動生成側の扱いは NOUS-104 の観点で見る）。
