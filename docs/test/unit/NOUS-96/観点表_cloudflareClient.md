# 単体テスト観点表：Cloudflare Workers AI の実装と LlmClient の選択（llm/cloudflareClient.ts・llm/createLlmClient.ts）

| 項目 | 内容 |
|---|---|
| 関連チケット | NOUS-96 |
| 作成者 | Mark Zuckerberg（開発担当） |
| 作成日 | 2026-10-23 |
| 対象 | apps/server/src/llm/cloudflareClient.ts, apps/server/src/llm/createLlmClient.ts |
| 言語 / フレームワーク | TypeScript / Vitest 2.1.9（environment: node） |
| テストファイル | apps/server/src/llm/cloudflareClient.test.ts（実装時、NOUS-51。createLlmClient の DEV-41〜43 を含む）, apps/server/src/llm/cloudflareClient.ut.test.ts（単体テストで追加）, apps/server/src/llm/createLlmClient.ut.test.ts（単体テストで追加） |
| 外部依存 | fetch（Cloudflare Workers AI の REST。テストでは差し替え、実際の API は呼ばない）, 時刻（nowMs。Clock の nowMs か Date.now）, AbortSignal（AbortSignal.timeout の 60 秒と緊急停止の signal を AbortSignal.any で合成）, 環境変数 CLOUDFLARE_ACCOUNT_ID・CLOUDFLARE_API_TOKEN（lib/env.ts が読み、createLlmClient に渡す） |
| 入力にした設計書 | BE 詳細設計 generation 2章（外部連携 Cloudflare Workers AI・LlmClient.generate）・4章（callCloudflare・toLlmError・computeNeurons）・6章, 基本設計書_概要 7章 IF-001 |

このファイルは `docs/test/unit/_build/build_matrix.py` で JSON から作る。直すときは JSON を直して作り直す。

## 1. 分岐の一覧

| ID | 条件 | 場所 |
|---|---|---|
| B1 | usesThinkingFlag：modelId が gemma-4 か glm を含む | cloudflareClient.ts:51,74 |
| B2 | usesNoThinkSuffix：modelId が qwen3 を含む | cloudflareClient.ts:56,62 |
| B3 | buildRequestBody：最後の user がある（target !== undefined） | cloudflareClient.ts:65 |
| B4 | errorsOf：本文がオブジェクトで errors が配列 | cloudflareClient.ts:88 |
| B5 | errorsOf：要素が null でないオブジェクト | cloudflareClient.ts:89 |
| B6 | describeErrors：errors の要素が 1 件以上 | cloudflareClient.ts:97 |
| B7 | toLlmError：status === 429 | cloudflareClient.ts:103 |
| B8 | toLlmError：errors に code 3036 がある | cloudflareClient.ts:104-107 |
| B9 | computeNeurons：報告値が有限の数で 0 以上 | cloudflareClient.ts:120 |
| B10 | computeNeurons：単価表にあるモデル（?? の左） | cloudflareClient.ts:123 |
| B11 | toCount：有限の数で 0 以上 | cloudflareClient.ts:136 |
| B12 | toFetchError：依頼の signal が abort 済み | cloudflareClient.ts:141 |
| B13 | toFetchError：例外の名前が TimeoutError か AbortError | cloudflareClient.ts:145 |
| B14 | toFetchError：例外が Error のインスタンス | cloudflareClient.ts:144,149 |
| B15 | callCloudflare：options.fetch がある | cloudflareClient.ts:155 |
| B16 | callCloudflare：options.nowMs がない（Date.now を使う） | cloudflareClient.ts:156 |
| B17 | callCloudflare：呼ぶ前に signal が abort 済み | cloudflareClient.ts:157 |
| B18 | callCloudflare：fetch か response.text() が例外 | cloudflareClient.ts:165-178 |
| B19 | callCloudflare：本文の JSON.parse が例外 | cloudflareClient.ts:181-185 |
| B20 | callCloudflare：!response.ok | cloudflareClient.ts:187 |
| B21 | callCloudflare：本文が null、または success !== true | cloudflareClient.ts:191 |
| B22 | callCloudflare：choices[0].message.content が文字列でない | cloudflareClient.ts:195 |
| B23 | callCloudflare：usage.neurons が数値 | cloudflareClient.ts:213 |
| B24 | callCloudflare：options.timeoutMs がある | cloudflareClient.ts:162 |
| B25 | createLlmClient：llmMode === "cloudflare" | createLlmClient.ts:25 |
| B26 | createLlmClient：env.cloudflare === null | createLlmClient.ts:26 |
| B27 | createLlmClient：fixtureScenario を省略（既定の basic） | createLlmClient.ts:39 |

## 2. ケースの一覧（48 件。うち新しく足したもの 27 件）

| ID | 対象 | 分類 | 技法 | 観点 | 前提 | 入力 | 期待結果 | 分岐 | モック | 既存テストとの対応 | バグの疑い | テスト名 | 備考 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| TC-NOUS51_DEV-01 | callCloudflare / CloudflareClient.generate | 正常系 | 開発者テスト | URL・ヘッダー・本文を 2章どおりに送り、本文と usage を返す | なし | Gemma 4、system・user、maxTokens 300 | POST、Bearer トークン、本文（messages・max_tokens・temperature 0.9・chat_template_kwargs）、LlmResult（usage の値と durationMs 965） | B1-T, B4-F, B9-T, B11-T, B15-T, B16-F, B17-F, B18-F, B19-F, B20-F, B21-F, B22-F, B23-T, B24-F | fetch → 200（success true、choices[0].message.content、usage）、nowMs の差し替え | 実装時のテスト（NOUS-51） |  | TC-NOUS51_DEV-01 URL・ヘッダー・本文を 2章どおりに送り、本文と usage を返す |  |
| TC-NOUS51_DEV-02 | buildRequestBody | 正常系 | 開発者テスト | Qwen3 は user の末尾に ' /no_think' を付け、chat_template_kwargs を送らない | なし | Qwen3、system・user | user の末尾に /no_think。chat_template_kwargs なし | B1-F, B2-T, B3-T | なし | 実装時のテスト（NOUS-51） |  | TC-NOUS51_DEV-02 Qwen3 は user の末尾に ' /no_think' を付け、chat_template_kwargs を送らない |  |
| TC-NOUS51_DEV-03 | buildRequestBody | 正常系 | 開発者テスト | buildRequestBody は元の messages を書き換えない | なし | Qwen3 の依頼 | 元の user の content は変わらない | B2-T, B3-T | なし | 実装時のテスト（NOUS-51） |  | TC-NOUS51_DEV-03 buildRequestBody は元の messages を書き換えない |  |
| TC-NOUS51_DEV-04 | callCloudflare / computeNeurons | 正常系 | 開発者テスト | usage.neurons がなければ単価表から計算する | なし | usage { prompt_tokens 1000, completion_tokens 100 } | neurons = (1000×9091 + 100×27273) / 100 万 | B9-F, B10-F, B23-F | fetch → 200（neurons なし） | 実装時のテスト（NOUS-51） |  | TC-NOUS51_DEV-04 usage.neurons がなければ単価表から計算する |  |
| TC-NOUS51_DEV-05 | computeNeurons | 正常系 | 開発者テスト | computeNeurons は Gemma 4・Qwen3 の単価を使い分け、報告値を優先する | なし | Gemma 4・Qwen3・表にないモデル、報告値 12.3 | 各単価の値、報告値 12.3、表にないモデルは高い方の単価 | B9-T, B9-F, B10-T, B10-F | なし | 実装時のテスト（NOUS-51） |  | TC-NOUS51_DEV-05 computeNeurons は Gemma 4・Qwen3 の単価を使い分け、報告値を優先する |  |
| TC-NOUS51_DEV-06 | buildUrl | 正常系 | 開発者テスト | buildUrl は model_id の / をそのままパスに入れる | なし | アカウント ID、Qwen3 | .../ai/run/@cf/qwen/qwen3-30b-a3b-fp8 |  | なし | 実装時のテスト（NOUS-51） |  | TC-NOUS51_DEV-06 buildUrl は model_id の / をそのままパスに入れる |  |
| TC-NOUS51_DEV-11 | toLlmError | 異常系 | 開発者テスト | 429・3036 は FreeTierExceededError（再試行しない） | なし | 429、errors [{ code 3036 }] | FreeTierExceededError、kind free_tier、retryable 偽、detail に 3036 | B4-T, B5-F, B6-T, B7-T, B8-T | なし | 実装時のテスト（NOUS-51） |  | TC-NOUS51_DEV-11 429・3036 は FreeTierExceededError（再試行しない） |  |
| TC-NOUS51_DEV-12 | toLlmError | 異常系 | 開発者テスト | 3036 以外の 429 は RateLimitedError（3040・errors なし・JSON でない） | なし | 429 と、3040・errors なし・null の本文 | RateLimitedError、retryable 真 | B4-T, B4-F, B6-F, B7-T, B8-F | なし | 実装時のテスト（NOUS-51） |  | TC-NOUS51_DEV-12 3036 以外の 429 は RateLimitedError |  |
| TC-NOUS51_DEV-13 | toLlmError | 異常系 | 開発者テスト | HTTP 400・401・500・502・503 は ServerError（400・401 だけ再試行しない） | なし | 400・401・500・502・503 | ServerError、retryable は 400・401 だけ偽 | B7-F | なし | 実装時のテスト（NOUS-51） |  | TC-NOUS51_DEV-13 HTTP %i は ServerError（再試行 %s） |  |
| TC-NOUS51_DEV-14 | callCloudflare | 異常系 | 開発者テスト | 200 でも success=false なら ServerError | なし | 200、success false | ServerError、httpStatus 200 | B20-F, B21-T, B7-F | fetch → 200（success false） | 実装時のテスト（NOUS-51） |  | TC-NOUS51_DEV-14 200 でも success=false なら ServerError |  |
| TC-NOUS51_DEV-15 | callCloudflare | 異常系 | 開発者テスト | 200 で本文が JSON でない、または choices がなければ ServerError | なし | 200 "<html>"、200 choices [] | どちらも ServerError | B19-T, B21-T, B21-F, B22-T | fetch → 200（JSON でない・choices が空） | 実装時のテスト（NOUS-51） |  | TC-NOUS51_DEV-15 200 で本文が JSON でない、または choices がなければ ServerError |  |
| TC-NOUS51_DEV-16 | CloudflareClient.generate | 異常系 | 開発者テスト | HTTP の 429・3036 を generate から FreeTierExceededError で投げる | なし | 429、errors [{ code 3036 }] | FreeTierExceededError | B20-T, B7-T, B8-T | fetch → 429 | 実装時のテスト（NOUS-51） |  | TC-NOUS51_DEV-16 HTTP の 429・3036 を generate から FreeTierExceededError で投げる |  |
| TC-NOUS51_DEV-21 | callCloudflare | 異常系 | 開発者テスト | timeoutMs を超えたら TimeoutError | なし | timeoutMs 20 | TimeoutError、retryable 真、httpStatus null | B12-F, B13-T, B18-T, B24-T | fetch → signal の abort まで返らない | 実装時のテスト（NOUS-51） |  | TC-NOUS51_DEV-21 timeoutMs を超えたら TimeoutError |  |
| TC-NOUS51_DEV-22 | callCloudflare | 異常系 | 開発者テスト | 呼び出し中に signal が abort されたら CancelledError | なし | 呼び出し中に abort | CancelledError | B12-T, B18-T | fetch → signal の abort まで返らない | 実装時のテスト（NOUS-51） |  | TC-NOUS51_DEV-22 呼び出し中に signal が abort されたら CancelledError |  |
| TC-NOUS51_DEV-23 | callCloudflare | 異常系 | 開発者テスト | 呼ぶ前に abort 済みなら fetch を呼ばずに CancelledError | なし | abort 済みの signal | CancelledError。fetch は 0 回 | B17-T | fetch の差し替え | 実装時のテスト（NOUS-51） |  | TC-NOUS51_DEV-23 呼ぶ前に abort 済みなら fetch を呼ばずに CancelledError |  |
| TC-NOUS51_DEV-24 | callCloudflare | 異常系 | 開発者テスト | 接続の失敗は ServerError（httpStatus なし、再試行の対象） | なし | fetch が TypeError("fetch failed") | ServerError、httpStatus null、retryable 真 | B12-F, B13-F, B14-T, B18-T | fetch → TypeError | 実装時のテスト（NOUS-51） |  | TC-NOUS51_DEV-24 接続の失敗は ServerError（httpStatus なし、再試行の対象） |  |
| TC-NOUS51_DEV-31 | CloudflareClient.generate | 異常系 | 開発者テスト | 失敗（429・3036、500、接続の失敗）のエラーにトークンが含まれない | なし | 3 種の失敗 | エラーの JSON・文字列・stack にトークンがない | B18-T, B20-T | fetch → 429・500・TypeError | 実装時のテスト（NOUS-51） |  | TC-NOUS51_DEV-31 失敗（%s）のエラーにトークンが含まれない |  |
| TC-NOUS51_DEV-32 | CloudflareClient | 正常系 | 開発者テスト | クライアントを JSON にしても、列挙してもトークンが出ない | なし | createCloudflareClient | JSON.stringify・Object.values にトークンがない |  | なし | 実装時のテスト（NOUS-51） |  | TC-NOUS51_DEV-32 クライアントを JSON にしても、列挙してもトークンが出ない |  |
| TC-NOUS51_DEV-41 | createLlmClient | 正常系 | 開発者テスト | AISNS_LLM_MODE=cloudflare なら CloudflareClient、fixed なら FixedClient | なし | llmMode cloudflare（設定あり）、fixed | CloudflareClient、FixedClient | B25-T, B25-F, B26-F, B27-T | 時計の差し替え | 実装時のテスト（NOUS-51） |  | TC-NOUS51_DEV-41 AISNS_LLM_MODE=cloudflare なら CloudflareClient、fixed なら FixedClient |  |
| TC-NOUS51_DEV-42 | createLlmClient | 異常系 | 開発者テスト | cloudflare で設定がなければ、トークンを含まないエラー | なし | llmMode cloudflare、cloudflare null | Error「Cloudflare の設定がありません」 | B25-T, B26-T | 時計の差し替え | 実装時のテスト（NOUS-51） |  | TC-NOUS51_DEV-42 cloudflare で設定がなければ、トークンを含まないエラー |  |
| TC-NOUS51_DEV-43 | createLlmClient | 正常系 | 開発者テスト | 差し替えた fetch が CloudflareClient に渡る | なし | llmMode cloudflare、fetch の差し替え | fetch が 1 回呼ばれる | B25-T, B26-F | fetch → 200（success true、choices[0].message.content、usage） | 実装時のテスト（NOUS-51） |  | TC-NOUS51_DEV-43 差し替えた fetch が CloudflareClient に渡る |  |
| TC-UT_LLM-028 | buildRequestBody | 正常系 | 同値分割 | GLM 系のモデルは chat_template_kwargs で思考を止め、' /no_think' は付けない | なし | modelId "@cf/zai-org/glm-4.7-flash" | chat_template_kwargs { enable_thinking: false }。user の content は変わらない | B1-T, B2-F | なし | なし（DEV は Gemma 4 と Qwen3 だけ） |  | TC-UT_LLM-028 GLM 系のモデルは chat_template_kwargs で思考を止め、' /no_think' は付けない |  |
| TC-UT_LLM-029 | buildRequestBody | 正常系 | 同値分割 | Gemma 4・GLM・Qwen3 以外のモデルは、どちらの思考の止め方もしない | なし | modelId "@cf/meta/llama-3.1-8b-instruct" | chat_template_kwargs なし。messages は元のまま。max_tokens・temperature 0.9 はある | B1-F, B2-F | なし | なし |  | TC-UT_LLM-029 Gemma 4・GLM・Qwen3 以外のモデルは、どちらの思考の止め方もしない | 設計書（generation 2章）に、ほかのモデルの扱いの記載なし。実装の値 |
| TC-UT_LLM-030 | buildRequestBody | 正常系 | 分岐網羅 | Qwen3 で user のメッセージがなければ、何も付けずに送る | なし | Qwen3、system だけ | messages は元のまま（例外にしない） | B2-T, B3-F | なし | なし |  | TC-UT_LLM-030 Qwen3 で user のメッセージがなければ、何も付けずに送る |  |
| TC-UT_LLM-031 | buildRequestBody | 正常系 | 同値分割 | Qwen3 で user が 2 件あれば、最後の user だけに ' /no_think' を付ける | なし | Qwen3、user・system・user | 最後の user だけ末尾に /no_think。1 件目の user は元のまま | B2-T, B3-T | なし | なし（DEV-02 は user 1 件） |  | TC-UT_LLM-031 Qwen3 で user が 2 件あれば、最後の user だけに ' /no_think' を付ける |  |
| TC-UT_LLM-032 | buildUrl | 正常系 | 同値分割 | アカウント ID はパスの区切りにならないよう符号化する | なし | accountId "a/b?c"、Gemma 4 | .../accounts/a%2Fb%3Fc/ai/run/@cf/google/gemma-4-26b-a4b-it |  | なし | なし（DEV-06 は英数字のアカウント ID） |  | TC-UT_LLM-032 アカウント ID はパスの区切りにならないよう符号化する |  |
| TC-UT_LLM-033 | toLlmError | 異常系 | 同値分割 | errors[].code が文字列の "3036" でも、429 なら無料枠の超過とみなす | なし | 429、errors [{ code: "3036" }] | FreeTierExceededError | B7-T, B8-T | なし | なし（DEV-11 は数値の 3036） |  | TC-UT_LLM-033 errors[].code が文字列の "3036" でも、429 なら無料枠の超過とみなす |  |
| TC-UT_LLM-034 | toLlmError | 異常系 | 分岐網羅 | errors にオブジェクトでない要素が混ざっていても、オブジェクトの要素だけで判定し、detail に載せる | なし | 429、errors [null, "x", 7, { code: 3036, message: "limit" }] | FreeTierExceededError、detail は "http 429 3036:limit" | B4-T, B5-T, B5-F, B6-T, B7-T, B8-T | なし | なし |  | TC-UT_LLM-034 errors にオブジェクトでない要素が混ざっていても、オブジェクトの要素だけで判定し、detail に載せる |  |
| TC-UT_LLM-035 | toLlmError | 異常系 | 同値分割 | detail は「http <状態> <code>:<message>」を「; 」でつなぎ、errors がなければ「http <状態>」だけ | なし | 500、errors [{ code 1000, message "a" }, { code 1001, message "b" }]、500、本文 null | "http 500 1000:a; 1001:b"、"http 500" | B4-T, B4-F, B6-T, B6-F, B7-F | なし | 一部 TC-NOUS51_DEV-11（3036 を含むことだけ） |  | TC-UT_LLM-035 detail は「http <状態> <code>:<message>」を「; 」でつなぎ、errors がなければ「http <状態>」だけ | 書式は設計書に記載なし。実装の値（error_detail に残す内容） |
| TC-UT_LLM-036 | toLlmError | 異常系 | 同値分割 | 429 以外で 3036 が返っても、無料枠の超過にはしない | なし | 500、errors [{ code 3036 }] | ServerError（free_tier にしない） | B7-F | なし | なし |  | TC-UT_LLM-036 429 以外で 3036 が返っても、無料枠の超過にはしない | 設計書（generation 2章）は「429 かつ 3036」を free_tier とする |
| TC-UT_LLM-037 | toLlmError | 異常系 | 同値分割 | 400・401・429 以外の 4xx（403・404・413）は ServerError で、再試行しない | なし | 403・404・413、errors [{ code 1000 }] | ServerError、retryable 偽（IF-001 の再試行の対象は timeout・429（3036 以外）・5xx に限られる） | B7-F | なし | なし（DEV-13 は 400・401・5xx だけ） | ServerError.retryable が 400・401 以外を真にするため、403・404・413 も再試行の対象になる（疑い 1） | TC-UT_LLM-037 400・401・429 以外の 4xx（403・404・413）は ServerError で、再試行しない | 期待結果は BE 詳細設計 generation 2章 IF-001 の再試行の欄（2026-10-23 Kouhei Tajima 判断） |
| TC-UT_LLM-038 | computeNeurons | 正常系 | 境界値 | 報告された neurons が 0 なら 0 を使い、単価表で計算しない | なし | Gemma 4、1000・100、報告値 0 | 0 | B9-T | なし | なし（DEV-05 は 12.3） |  | TC-UT_LLM-038 報告された neurons が 0 なら 0 を使い、単価表で計算しない |  |
| TC-UT_LLM-039 | computeNeurons | 正常系 | 境界値 | 報告された neurons が負・NaN・Infinity なら、単価表から計算する | なし | Gemma 4、1000000・0、報告値 -0.001・NaN・Infinity | どれも 9091 | B9-F, B10-T | なし | なし |  | TC-UT_LLM-039 報告された neurons が負・NaN・Infinity なら、単価表から計算する |  |
| TC-UT_LLM-040 | callCloudflare | 異常系 | 分岐網羅 | 2xx でない応答の本文が JSON でなくても ServerError にし、detail は「http <状態>」 | なし | 502、本文 "<html>Bad Gateway</html>" | ServerError、httpStatus 502、detail "http 502"、retryable 真 | B19-T, B20-T, B4-F, B6-F, B7-F | fetch → 502（HTML） | なし（DEV-15 は 200 のとき） |  | TC-UT_LLM-040 2xx でない応答の本文が JSON でなくても ServerError にし、detail は「http <状態>」 |  |
| TC-UT_LLM-041 | callCloudflare | 正常系 | 同値分割 | usage がなければトークンを 0 とし、neurons も 0 になる | なし | 200、result に usage なし | promptTokens 0、completionTokens 0、neurons 0 | B11-F, B23-F, B9-F | fetch → 200（usage なし） | なし（DEV-04 は neurons だけがない） |  | TC-UT_LLM-041 usage がなければトークンを 0 とし、neurons も 0 になる |  |
| TC-UT_LLM-042 | callCloudflare | 正常系 | 同値分割 | usage のトークンが負・文字列なら 0 として扱う | なし | prompt_tokens -5、completion_tokens "72" | promptTokens 0、completionTokens 0 | B11-F | fetch → 200（usage の値が不正） | なし |  | TC-UT_LLM-042 usage のトークンが負・文字列なら 0 として扱う |  |
| TC-UT_LLM-043 | callCloudflare | 正常系 | 分岐網羅 | usage.neurons が文字列なら報告値として使わず、単価表から計算する | なし | usage { prompt_tokens 1000000, completion_tokens 0, neurons "15.4" } | neurons 9091 | B23-F, B9-F | fetch → 200（neurons が文字列） | なし |  | TC-UT_LLM-043 usage.neurons が文字列なら報告値として使わず、単価表から計算する |  |
| TC-UT_LLM-044 | callCloudflare | 異常系 | 同値分割 | choices[0].message.content が文字列でなければ ServerError | なし | 200、content 123、content null | どちらも ServerError、httpStatus 200 | B21-F, B22-T | fetch → 200（content が文字列でない） | 一部 TC-NOUS51_DEV-15（choices が空のときだけ） |  | TC-UT_LLM-044 choices[0].message.content が文字列でなければ ServerError |  |
| TC-UT_LLM-045 | callCloudflare | 正常系 | 境界値 | 時計が戻っても durationMs は負にならず 0 になる | なし | nowMs が 5000 → 4000 を返す | durationMs 0 | B16-F | fetch → 200（success true、choices[0].message.content、usage）、nowMs の差し替え | なし |  | TC-UT_LLM-045 時計が戻っても durationMs は負にならず 0 になる |  |
| TC-UT_LLM-046 | callCloudflare | 正常系 | 依存 | fetch を渡さなければ globalThis.fetch を、nowMs を渡さなければ Date.now を使う | なし | CloudflareClient（fetch・nowMs なし） | globalThis.fetch が 1 回呼ばれる。durationMs は Date.now の差 | B15-F, B16-T | globalThis.fetch（vi.stubGlobal）、Date.now（vi.spyOn） | なし（DEV は fetch を必ず渡している） |  | TC-UT_LLM-046 fetch を渡さなければ globalThis.fetch を、nowMs を渡さなければ Date.now を使う |  |
| TC-UT_LLM-047 | callCloudflare | 正常系 | 依存 | timeoutMs を渡さなければ 60 秒で打ち切る | なし | CloudflareClient（timeoutMs なし） | AbortSignal.timeout が 60000 で呼ばれる | B24-F | fetch → 200（success true、choices[0].message.content、usage）、AbortSignal.timeout（vi.spyOn） | なし（DEV-21 は timeoutMs 20） |  | TC-UT_LLM-047 timeoutMs を渡さなければ 60 秒で打ち切る |  |
| TC-UT_LLM-048 | callCloudflare | 異常系 | エラー処理 | 本文の読み取り（response.text）が失敗したら ServerError（httpStatus なし） | なし | fetch は 200 を返すが text() が TypeError | ServerError、httpStatus null、retryable 真 | B12-F, B13-F, B14-T, B18-T | fetch → text() が例外の Response | なし |  | TC-UT_LLM-048 本文の読み取り（response.text）が失敗したら ServerError（httpStatus なし） |  |
| TC-UT_LLM-049 | callCloudflare | 異常系 | 分岐網羅 | 依頼の signal が abort されていないのに AbortError で失敗したら TimeoutError | なし | fetch が DOMException（AbortError）を投げる | TimeoutError | B12-F, B13-T, B18-T | fetch → DOMException("aborted", "AbortError") | 一部 TC-NOUS51_DEV-21（TimeoutError の名前のとき） |  | TC-UT_LLM-049 依頼の signal が abort されていないのに AbortError で失敗したら TimeoutError |  |
| TC-UT_LLM-050 | callCloudflare | 異常系 | 分岐網羅 | fetch が Error 以外を投げたら ServerError にし、detail に値を文字列で残す | なし | fetch が "boom" を投げる | ServerError、detail "fetch : boom"、cause "boom" | B12-F, B13-F, B14-F, B18-T | fetch → 文字列を throw | なし |  | TC-UT_LLM-050 fetch が Error 以外を投げたら ServerError にし、detail に値を文字列で残す |  |
| TC-UT_LLM-051 | CloudflareClient.generate | 異常系 | エラー処理 | 401（認証の失敗）は再試行しない ServerError で、detail・message・stack にトークンが含まれない | なし | 401、errors [{ code 10000, message "Authentication error" }] | ServerError、retryable 偽、detail "http 401 10000:Authentication error"。エラーの JSON・文字列・stack にトークンがない | B4-T, B6-T, B7-F, B20-T | fetch → 401 | 一部 TC-NOUS51_DEV-31（429・500・接続の失敗だけ） |  | TC-UT_LLM-051 401（認証の失敗）は再試行しない ServerError で、エラーにトークンが含まれない |  |
| TC-UT_LLM-052 | createLlmClient | 正常系 | 分岐網羅 | 固定応答のシナリオの名前を指定すると、そのシナリオのファイルを読む | mkdtemp の一時ディレクトリに s2/aoi-1.json を置く | llmMode fixed、fixtureScenario "s2" | s2/aoi-1.json の text を返す | B25-F, B27-F | 時計の差し替え | なし（DEV-41 は既定の basic） |  | TC-UT_LLM-052 固定応答のシナリオの名前を指定すると、そのシナリオのファイルを読む |  |
| TC-UT_LLM-053 | createLlmClient | 正常系 | 依存 | cloudflare のとき、durationMs は渡した時計の nowMs で測る | FakeClock 2026-10-22T09:00:00.000Z | llmMode cloudflare、fetch の中で FakeClock を 1200 ms 進める | durationMs 1200 | B25-T, B26-F | fetch → 200（success true、choices[0].message.content、usage）、FakeClock | なし（DEV-41・43 は時計を見ていない） |  | TC-UT_LLM-053 cloudflare のとき、durationMs は渡した時計の nowMs で測る |  |
| TC-UT_LLM-054 | createLlmClient | 正常系 | 同値分割 | fixed のときは Cloudflare の設定があっても FixedClient を返す | なし | llmMode fixed、cloudflare { accountId, apiToken } | FixedClient | B25-F, B27-T | 時計の差し替え | なし |  | TC-UT_LLM-054 fixed のときは Cloudflare の設定があっても FixedClient を返す |  |

## 3. 確認事項・バグの疑い

- 疑い 1：toLlmError は 400・401・429 以外の 4xx（403 の権限不足、404 のモデル名の誤り、413 の本文が大きすぎるなど）を ServerError にし、ServerError.retryable が 400・401 以外を真にするため、再試行の対象になっている（llmClient.ts:86、cloudflareClient.ts:109-110）。設計書（generation 2章 IF-001）は再試行の対象を timeout・429（3036 以外）・5xx に限っているので、403・404・413 は再試行しないのが仕様（2026-10-23 Kouhei Tajima 判断）。TC-UT_LLM-037 は仕様どおり「再試行しない」を期待結果にしており、実施のときに NG になる見込み。
- 確認事項 1：buildRequestBody は、Gemma 4・GLM・Qwen3 以外のモデルでは思考を止める指定を何も送らない（TC-UT_LLM-029）。world_settings.model_id は DB の CHECK で Gemma 4 と Qwen3 の 2 つに限られるため、今は影響がない。モデルを足すときに見直す。
