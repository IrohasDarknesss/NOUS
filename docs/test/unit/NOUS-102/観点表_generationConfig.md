# 単体テスト観点表：行動生成の設定の読み込み（config/generationConfig.ts）

| 項目 | 内容 |
|---|---|
| 関連チケット | NOUS-102 |
| 作成者 | Takaya Ishikawa（開発担当） |
| 作成日 | 2026-10-23 |
| 対象 | apps/server/src/config/generationConfig.ts |
| 言語 / フレームワーク | TypeScript / Vitest 2.1.9（environment: node） |
| テストファイル | apps/server/src/config/generationConfig.test.ts（実装時、NOUS-48）, apps/server/src/config/generationConfig.ut.test.ts（単体テストで追加） |
| 外部依存 | ファイルの読み込み（node:fs の readFileSync。テストは一時ディレクトリのファイルを使う）, Zod |
| 入力にした設計書 | BE 詳細設計 generation 4章 loadGenerationConfig, 行動生成とプロンプトの設計 3章・4章・9章 |

このファイルは `docs/test/unit/_build/build_matrix.py` で JSON から作る。直すときは JSON を直して作り直す。

## 1. 分岐の一覧

| ID | 条件 | 場所 |
|---|---|---|
| B1 | !result.success（Zod の検証に通らない） | generationConfig.ts:37 |
| B2 | issue.path.join(".") \|\| "(root)"（項目の場所が空＝全体の誤り） | generationConfig.ts:38 |
| B3 | readFileSync が例外（ファイルが無い・読めない） | generationConfig.ts:47-51 |
| B4 | JSON.parse が例外（JSON として読めない） | generationConfig.ts:53-57 |

## 2. ケースの一覧（16 件。うち新しく足したもの 9 件）

| ID | 対象 | 分類 | 技法 | 観点 | 前提 | 入力 | 期待結果 | 分岐 | モック | 既存テストとの対応 | バグの疑い | テスト名 | 備考 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| TC-NOUS48_DEV-11 | loadGenerationConfig | 正常系 | 開発者テスト | リポジトリの config/generation.json を読める | リポジトリの config/generation.json | config/generation.json のパス | participation[3]=0.6、candidateCount=2、weights.follow=1.5、recentPenalty=0.4、firstPersonRules 3 件 | B1-F, B3-F, B4-F | なし | 実装時のテスト（NOUS-48） |  | TC-NOUS48_DEV-11 リポジトリの config/generation.json を読める |  |
| TC-NOUS48_DEV-12 | parseGenerationConfig | 正常系 | 開発者テスト | 正しい値はそのまま返す | なし | 設計書 3・4・9章の既定値 | 入力と等しいオブジェクト | B1-F | なし | 実装時のテスト（NOUS-48） |  | TC-NOUS48_DEV-12 正しい値はそのまま返す |  |
| TC-NOUS48_DEV-13 | parseGenerationConfig | 正常系 | 開発者テスト | 境界値（確率 0 と 1、重み 0、候補の数 2 と 4）は通る | なし | participation[1]=0・[5]=1、weights.unfollow=0、candidateCount=2・4 | 例外にならない | B1-F | なし | 実装時のテスト（NOUS-48） |  | TC-NOUS48_DEV-13 境界値（確率 0 と 1、重み 0、候補の数 2 と 4）は通る |  |
| TC-NOUS48_DEV-14 | parseGenerationConfig | 異常系 | 開発者テスト | 不正な値（確率の範囲外・欠け、重みが負・欠け、候補の数 1・5・2.5、減点 1.5、キーワードが空、知らない項目、項目の欠け）は ConfigError | なし | 12 種類の不正な値（it.each） | ConfigError | B1-T, B2-F | なし | 実装時のテスト（NOUS-48） |  | TC-NOUS48_DEV-14 不正な値は ConfigError |  |
| TC-NOUS48_DEV-15 | loadGenerationConfig | 異常系 | 開発者テスト | ファイルが無ければ ConfigError | なし | 存在しないパス | ConfigError | B3-T | なし | 実装時のテスト（NOUS-48） |  | TC-NOUS48_DEV-15 ファイルが無ければ ConfigError |  |
| TC-NOUS48_DEV-16 | loadGenerationConfig | 異常系 | 開発者テスト | JSON として読めなければ ConfigError | 一時ファイルに "{ not json" | そのパス | ConfigError | B3-F, B4-T | なし | 実装時のテスト（NOUS-48） |  | TC-NOUS48_DEV-16 JSON として読めなければ ConfigError |  |
| TC-NOUS48_DEV-17 | loadGenerationConfig | 異常系 | 開発者テスト | エラーの文言に不正な項目の場所が入る | 一時ファイルに candidateCount=9 の JSON | そのパス | 文言に candidateCount を含む | B3-F, B4-F, B1-T, B2-F | なし | 実装時のテスト（NOUS-48） |  | TC-NOUS48_DEV-17 エラーの文言に不正な項目の場所が入る |  |
| TC-UT_CFG-001 | parseGenerationConfig | 正常系 | 境界値 | 減点（recentPenalty）の下限 0 と上限 1 は通る | なし | recentPenalty=0、recentPenalty=1 | どちらも例外にならず、値がそのまま返る | B1-F | なし | なし（DEV-13 は減点の境界を見ていない） |  | TC-UT_CFG-001 減点の境界値（0 と 1）は通る |  |
| TC-UT_CFG-002 | parseGenerationConfig | 正常系 | 境界値 | 一人称の表（firstPersonRules）は 0 件でも通る（C03 を使わない設定） | なし | firstPersonRules=[] | 例外にならず、firstPersonRules は [] | B1-F | なし | なし |  | TC-UT_CFG-002 一人称の表は空の配列でも通る | 設計書 9章は件数を決めていない。スキーマに min が無いので通るのが実装の値 |
| TC-UT_CFG-003 | parseGenerationConfig | 異常系 | 同値分割 | DEV-14 に無い無効クラス（減点が負、重みに知らない種類、活動頻度 6、確率・候補の数が文字列、合わない一人称が空、空の文字列、表に知らない項目）は ConfigError | なし | 1 行に無効な値 1 種類ずつ、8 種類（it.each） | ConfigError | B1-T, B2-F | なし | 一部 TC-NOUS48_DEV-14（減点は上限側、知らない項目は全体だけ） |  | TC-UT_CFG-003 不正な値は ConfigError |  |
| TC-UT_CFG-004 | parseGenerationConfig | 異常系 | 分岐網羅 | 全体がオブジェクトでないとき、文言の場所が (root) になる | なし | null、[]、"config"（it.each） | ConfigError、文言に (root) を含む | B1-T, B2-T | なし | なし（DEV は項目の場所があるものだけ） |  | TC-UT_CFG-004 全体がオブジェクトでなければ ConfigError で、場所は (root) |  |
| TC-UT_CFG-005 | parseGenerationConfig | 異常系 | エラー処理 | 出どころを省くと文言に config/generation.json が入り、原因（ZodError）を cause に残す | なし | candidateCount=9、source を省く | ConfigError、文言に config/generation.json、cause あり | B1-T, B2-F | なし | なし |  | TC-UT_CFG-005 出どころを省くと文言に config/generation.json が入り、原因の ZodError を cause に残す |  |
| TC-UT_CFG-006 | loadGenerationConfig | 異常系 | エラー処理 | ファイルが無いとき、文言にパスが入り、元の例外を cause に残す | なし | 存在しないパス | ConfigError、文言にパス、cause あり | B3-T | なし | 一部 TC-NOUS48_DEV-15（型だけを見ている） |  | TC-UT_CFG-006 ファイルが無いときは、パスを文言に入れ、元の例外を cause に残す |  |
| TC-UT_CFG-007 | loadGenerationConfig | 異常系 | エラー処理 | JSON として読めないとき、文言にパスが入り、SyntaxError を cause に残す | 一時ファイルに "{ not json" | そのパス | ConfigError、文言にパス、cause は SyntaxError | B3-F, B4-T | なし | 一部 TC-NOUS48_DEV-16（型だけを見ている） |  | TC-UT_CFG-007 JSON として読めないときは、パスを文言に入れ、SyntaxError を cause に残す |  |
| TC-UT_CFG-008 | loadGenerationConfig | 異常系 | 境界値 | 空のファイル（0 バイト）は JSON として読めず ConfigError | 一時ファイルに空の文字列 | そのパス | ConfigError | B3-F, B4-T | なし | なし |  | TC-UT_CFG-008 空のファイルは JSON として読めず ConfigError |  |
| TC-UT_CFG-009 | loadGenerationConfig | 異常系 | エラー処理 | ファイルの値が不正なとき、文言の出どころがファイルのパスになる | 一時ファイルに recentPenalty=2 の JSON | そのパス | ConfigError、文言にパスと recentPenalty を含む | B3-F, B4-F, B1-T, B2-F | なし | 一部 TC-NOUS48_DEV-17（項目の場所だけを見ている） |  | TC-UT_CFG-009 ファイルの値が不正なときは、文言の出どころがファイルのパスになる |  |

## 3. 確認事項・バグの疑い

- 確認事項 1：設計書は一人称の表（firstPersonRules）の件数を決めていない。0 件の設定は通る（TC-UT_CFG-002）。C03 を止めたいときの設定として使ってよいかを確認したい。
- 確認事項 2：weights がすべて 0 の設定も検証を通る。このとき候補の抽選は ['post'] を返す（観点表_gate_candidates_rng の TC-UT_CAND-014）。起動時に弾くかどうかは設計書に記載がない。
