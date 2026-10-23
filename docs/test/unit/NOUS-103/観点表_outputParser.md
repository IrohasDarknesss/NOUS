# 単体テスト観点表：出力の取り出しと形の検証（generation/outputParser.ts）

| 項目 | 内容 |
|---|---|
| 関連チケット | NOUS-103 |
| 作成者 | Takaya Ishikawa（開発担当） |
| 作成日 | 2026-10-23 |
| 対象 | apps/server/src/generation/outputParser.ts |
| 言語 / フレームワーク | TypeScript / Vitest 2.1.9（environment: node） |
| テストファイル | apps/server/src/generation/outputParser.test.ts（実装時、NOUS-62）, apps/server/src/generation/outputParser.ut.test.ts（単体テストで追加） |
| 外部依存 | なし（文字列と JSON と Zod だけを使う純粋関数） |
| 入力にした設計書 | 行動生成とプロンプトの設計 6.1・6.2, BE 詳細設計 generation 4章 parseOutput |

このファイルは `docs/test/unit/_build/build_matrix.py` で JSON から作る。直すときは JSON を直して作り直す。

## 1. 分岐の一覧

| ID | 条件 | 場所 |
|---|---|---|
| B1 | thinkEnd >= 0（</think> がある） | outputParser.ts:50 |
| B2 | start < 0（{ がない） | outputParser.ts:56 |
| B3 | end < start（} が { より前にしかない） | outputParser.ts:56 |
| B4 | JSON.parse で例外 | outputParser.ts:60-64 |
| B5 | !parsed.success（ActionSchema に合わない） | outputParser.ts:67 |

## 2. ケースの一覧（21 件。うち新しく足したもの 16 件）

| ID | 対象 | 分類 | 技法 | 観点 | 前提 | 入力 | 期待結果 | 分岐 | モック | 既存テストとの対応 | バグの疑い | テスト名 | 備考 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| TC-NOUS62_DEV-01 | parseOutput | 正常系 | 開発者テスト | 素の JSON を取り出す | なし | {"action":"post","target":null,"text":"こんにちは"} | { action: post, target: null, text: こんにちは } | B1-F, B2-F, B3-F, B4-F, B5-F | なし | 実装時のテスト（NOUS-62） |  | TC-NOUS62_DEV-01 素の JSON を取り出す |  |
| TC-NOUS62_DEV-02 | parseOutput | 正常系 | 開発者テスト | 各入力 も取り出す | なし | ```json の囲み、``` の囲み、前後の空白と文、</think> の後ろ | どれも { action: reply, target: P3, text: なるほど } | B1-T, B1-F, B5-F | なし | 実装時のテスト（NOUS-62） |  | TC-NOUS62_DEV-02 %s も取り出す | it.each の 4 行を 1 件として数える |
| TC-NOUS62_DEV-03 | parseOutput | 正常系 | 開発者テスト | null の項目が省略されていても null とみなす | なし | {"action":"none"}、{"action":"like","target":"P1"}、follow の text: null | 省略された項目は null になる | B5-F | なし | 実装時のテスト（NOUS-62） |  | TC-NOUS62_DEV-03 null の項目が省略されていても null とみなす |  |
| TC-NOUS62_DEV-04 | parseOutput | 異常系 | 開発者テスト | 各入力 は InvalidFormatError | なし | JSON がない・壊れている・未知の action・組み合わせの違反など 12 種 | InvalidFormatError | B2-T, B4-T, B5-T | なし | 実装時のテスト（NOUS-62） |  | TC-NOUS62_DEV-04 %s は InvalidFormatError | 複数の無効クラスを 1 件にまとめているため、detail は UT_OUT-002〜005 で 1 件ずつ確かめる |
| TC-NOUS62_DEV-05 | parseOutput | 異常系 | 開発者テスト | InvalidFormatError の kind は invalid_format で、理由を detail に残す | なし | "JSON なし" | kind=invalid_format、retryable=false、detail=no_json_object | B2-T | なし | 実装時のテスト（NOUS-62） |  | TC-NOUS62_DEV-05 InvalidFormatError の kind は invalid_format で、理由を detail に残す |  |
| TC-UT_OUT-001 | parseOutput | 正常系 | 分岐網羅 | </think> が 2 つあるときは、最後の </think> の後ろだけを使う | なし | <think>a</think>{"action":"post",...}</think>{"action":"none"} | { action: none, target: null, text: null }（最後の </think> の後ろ） | B1-T, B5-F | なし | 一部 TC-NOUS62_DEV-02（</think> が 1 つのときだけ） |  | TC-UT_OUT-001 </think> が 2 つあるときは、最後の </think> の後ろだけを使う |  |
| TC-UT_OUT-002 | parseOutput | 異常系 | 分岐網羅 | </think> の後ろに JSON がなければ、思考の中の JSON は使わず no_json_object | なし | <think>{"action":"none"}</think>今日はやめておきます | InvalidFormatError、detail=no_json_object | B1-T, B2-T | なし | なし（思考の中の JSON を使わないことは見ていない） |  | TC-UT_OUT-002 </think> の後ろに JSON がなければ、思考の中の JSON は使わず no_json_object |  |
| TC-UT_OUT-003 | parseOutput | 異常系 | 分岐網羅 | } が { より前にしかないときは no_json_object | なし | "} 投稿しません {" | InvalidFormatError、detail=no_json_object | B1-F, B2-F, B3-T | なし | なし（DEV は { がない場合だけ） |  | TC-UT_OUT-003 } が { より前にしかないときは no_json_object |  |
| TC-UT_OUT-004 | parseOutput | 異常系 | エラー処理 | JSON として読めなければ json_parse_error | なし | {"action":"post",} | InvalidFormatError、kind=invalid_format、detail=json_parse_error | B3-F, B4-T | なし | 一部 TC-NOUS62_DEV-04（例外の型だけ） |  | TC-UT_OUT-004 JSON として読めなければ json_parse_error |  |
| TC-UT_OUT-005 | parseOutput | 異常系 | エラー処理 | スキーマに合わなければ detail が schema: で始まり、項目の名前を含む | なし | {"action":"share","target":null,"text":null} | InvalidFormatError、detail が「schema: 」で始まり action を含む | B4-F, B5-T | なし | 一部 TC-NOUS62_DEV-04（例外の型だけ） |  | TC-UT_OUT-005 スキーマに合わなければ detail が schema: で始まり、項目の名前を含む |  |
| TC-UT_OUT-006 | parseOutput | 正常系 | 境界値 | P 番号の桁の下限と上限は合格する | なし | like の target = P1、P99 | そのまま取り出す | B5-F | なし | なし（DEV は P3・P1 と、不合格の P100 だけ） |  | TC-UT_OUT-006 P 番号の桁の下限と上限は合格する | it.each の 2 行を 1 件として数える |
| TC-UT_OUT-007 | parseOutput | 正常系 | 境界値 | ハンドルの 3 字と 20 字は合格する | なし | follow の target = @abc、@ + a×20 | そのまま取り出す | B5-F | なし | なし（DEV は不合格の 2 字だけ） |  | TC-UT_OUT-007 ハンドルの 3 字と 20 字は合格する | it.each の 2 行を 1 件として数える |
| TC-UT_OUT-008 | parseOutput | 異常系 | 境界値 | ハンドルが 21 字なら InvalidFormatError | なし | follow の target = @ + a×21 | InvalidFormatError（schema） | B5-T | なし | なし |  | TC-UT_OUT-008 ハンドルが 21 字なら InvalidFormatError |  |
| TC-UT_OUT-009 | parseOutput | 異常系 | 同値分割 | ハンドルに英数字と _ 以外の字があれば InvalidFormatError | なし | unfollow の target = @ha-ru | InvalidFormatError（schema） | B5-T | なし | なし |  | TC-UT_OUT-009 ハンドルに英数字と _ 以外の字があれば InvalidFormatError |  |
| TC-UT_OUT-010 | parseOutput | 異常系 | 境界値 | P 番号に数字がなければ InvalidFormatError | なし | reply の target = P | InvalidFormatError（schema） | B5-T | なし | なし（DEV は 3 桁と数字だけ） |  | TC-UT_OUT-010 P 番号に数字がなければ InvalidFormatError |  |
| TC-UT_OUT-011 | parseOutput | 正常系 | 同値分割 | 表にない余分なキーは捨てて取り出す | なし | like に "reason":"好きな話題" を足した JSON | reason を捨てた { action: like, target: P2, text: null } | B5-F | なし | なし |  | TC-UT_OUT-011 表にない余分なキーは捨てて取り出す | 設計書に記載なし。Zod の z.object の既定（余分なキーを捨てる）の値 |
| TC-UT_OUT-012 | parseOutput | 異常系 | 同値分割 | action が大文字まじり（Post）なら InvalidFormatError | なし | action = "Post" | InvalidFormatError（schema） | B5-T | なし | なし（DEV は未知の語 share だけ） |  | TC-UT_OUT-012 action が大文字まじり（Post）なら InvalidFormatError |  |
| TC-UT_OUT-013 | parseOutput | 異常系 | 同値分割 | text が文字列でなく数値なら InvalidFormatError | なし | post の text = 140（数値） | InvalidFormatError（schema） | B5-T | なし | なし |  | TC-UT_OUT-013 text が文字列でなく数値なら InvalidFormatError |  |
| TC-UT_OUT-014 | parseOutput | 異常系 | 同値分割 | reply の target が null なら InvalidFormatError | なし | reply の target = null | InvalidFormatError（schema） | B5-T | なし | なし |  | TC-UT_OUT-014 reply の target が null なら InvalidFormatError |  |
| TC-UT_OUT-015 | parseOutput | 正常系 | 同値分割 | 大文字の言語名（```JSON）と CRLF の囲みも外して取り出す | なし | ```JSON\r\n{...}\r\n``` | { action: none, target: null, text: null } | B1-F, B5-F | なし | 一部 TC-NOUS62_DEV-02（小文字と LF だけ） |  | TC-UT_OUT-015 大文字の言語名（```JSON）と CRLF の囲みも外して取り出す |  |
| TC-UT_OUT-016 | parseOutput | 正常系 | 境界値 | post の text が空文字でも形としては通す（空白の拒否は validateAction） | なし | post の text = "" | { action: post, target: null, text: "" }（空白の拒否は validateAction で行う） | B5-F | なし | なし |  | TC-UT_OUT-016 post の text が空文字でも形としては通す（空白の拒否は validateAction） | 確認事項 1 を参照 |

## 3. 確認事項・バグの疑い

- 確認事項 1：6.1 は post・reply の text を「必須、1〜140 字」とするが、parseOutput は空文字や 141 字以上も通し、validateAction の truncateText で拒否・切り詰めを行う（実装のコメントのとおり）。結果の invalid_format は同じなので、設計書の 6.2 の手順 4 に「字数は 6.3 で見る」と書き足すことを提案する。
