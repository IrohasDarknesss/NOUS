# 単体テスト観点表：ページ送りのカーソル（lib/cursor.ts）

| 項目 | 内容 |
|---|---|
| 関連チケット | NOUS-89（見本） |
| 作成者 | Jane Doe（テスト担当） |
| 作成日 | 2026-10-23 |
| 対象 | apps/server/src/lib/cursor.ts |
| 言語 / フレームワーク | TypeScript / Vitest 2.1.9（environment: node） |
| テストファイル | apps/server/src/lib/cursor.test.ts（実装時、NOUS-56）, apps/server/src/lib/cursor.ut.test.ts（単体テストで追加） |
| 外部依存 | なし（Buffer と JSON だけを使う純粋関数） |
| 入力にした設計書 | BE 詳細設計 admin_auth 4章 encodeCursor・decodeCursor, BE 詳細設計 observer 4章 parseListQuery |

このファイルは `docs/test/unit/_build/build_matrix.py` で JSON から作る。直すときは JSON を直して作り直す。

## 1. 分岐の一覧

| ID | 条件 | 場所 |
|---|---|---|
| B1 | !cursor（空文字・undefined） | cursor.ts:16 |
| B2 | !BASE64URL_PATTERN.test(cursor)（Base64URL の字以外を含む） | cursor.ts:16 |
| B3 | Base64URL の復号・JSON.parse で例外 | cursor.ts:20-24 |
| B4 | !Array.isArray(parsed) | cursor.ts:26 |
| B5 | 配列に文字列でない要素がある（every の偽） | cursor.ts:26 |

## 2. ケースの一覧（12 件。うち新しく足したもの 10 件）

| ID | 対象 | 分類 | 技法 | 観点 | 前提 | 入力 | 期待結果 | 分岐 | モック | 既存テストとの対応 | バグの疑い | テスト名 | 備考 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| TC-NOUS56_DEV-01 | encodeCursor / decodeCursor | 正常系 | 開発者テスト | 文字列の配列を符号化して復号すると元に戻る（2要素・空配列・日本語と記号） | なし | ["7200","01JB…P01"]、["2026-10-21T10:00:00.000Z","01JB…A01"]、[]、["日本語","a+b/c="] | 符号化した文字列は Base64URL の字だけ。復号すると元の配列と等しい | B1-F, B2-F, B3-F, B4-F, B5-F | なし | 実装時のテスト（NOUS-56） |  | TC-NOUS56_DEV-01 encodeCursor と decodeCursor で文字列の配列を往復できる |  |
| TC-NOUS56_DEV-02 | decodeCursor | 異常系 | 開発者テスト | 不正なカーソルは 400 VALIDATION_ERROR（fields.cursor）になる | なし | ""、"bad+base64/="、JSON でない、オブジェクト、数値を含む配列 | AppError、code VALIDATION_ERROR、status 400、fields.cursor が空でない | B1-T, B2-T, B3-T, B4-T, B5-T | なし | 実装時のテスト（NOUS-56） |  | TC-NOUS56_DEV-02 decodeCursor は不正な Base64URL・不正な JSON・文字列の配列でない値で 400 VALIDATION_ERROR（fields.cursor）を投げる | 複数の無効クラスを1件にまとめているため、どの分岐で落ちたかは UT_LIB-005〜010 で1件ずつ確かめる |
| TC-UT_LIB-001 | encodeCursor | 正常系 | 同値分割 | JSON.stringify した文字列を、パディングなしの Base64URL にする（設計書の手順どおりの値になる） | なし | values = ["a"] | "WyJhIl0"（'["a"]' の Base64URL。末尾に = を付けない） |  | なし | なし（DEV-01 は往復だけで、符号化の値そのものは見ていない） |  | TC-UT_LIB-001 encodeCursor は JSON をパディングなしの Base64URL にする |  |
| TC-UT_LIB-002 | encodeCursor / decodeCursor | 正常系 | 境界値 | 要素が空文字だけの配列（文字列の長さの下限）も往復できる | なし | values = [""] | 符号化は "WyIiXQ"、復号すると [""] | B1-F, B2-F, B3-F, B4-F, B5-F | なし | なし（DEV-01 は空配列 [] まで） |  | TC-UT_LIB-002 空文字だけの配列も往復できる |  |
| TC-UT_LIB-003 | encodeCursor / decodeCursor | 正常系 | 同値分割 | JSON でエスケープが必要な字（"・\・改行）と、サロゲートペアの絵文字・U+2028 を含んでも往復できる | なし | values = ["say \"hi\"", "a\\b", "1行目\n2行目", "\u{1F600}", "\u2028"] | 復号すると元の配列と等しい | B1-F, B2-F, B3-F, B4-F, B5-F | なし | なし |  | TC-UT_LIB-003 エスケープが要る字と絵文字を含んでも往復できる |  |
| TC-UT_LIB-004 | decodeCursor | 異常系 | 境界値 | cursor が undefined（クエリの省略を呼び出し側が取りこぼした場合）でも、TypeError ではなく 400 になる | TypeScript の型を外して呼ぶ（as unknown as string） | cursor = undefined | AppError、code VALIDATION_ERROR、status 400 | B1-T | なし | なし（DEV-02 は空文字だけ） |  | TC-UT_LIB-004 cursor が undefined でも 400 VALIDATION_ERROR になる |  |
| TC-UT_LIB-005 | decodeCursor | 異常系 | 境界値 | 末尾にパディング（=）の付いた Base64URL は受け付けない（encodeCursor はパディングを付けない） | なし | cursor = "WyJhIl0=" | AppError、code VALIDATION_ERROR、status 400 | B1-F, B2-T | なし | 一部 TC-NOUS56_DEV-02（"bad+base64/=" は + と / でも落ちるため、= 単独では確かめていない） |  | TC-UT_LIB-005 パディング付きのカーソルは 400 VALIDATION_ERROR になる | 設計書はパディングの扱いを書いていない。カーソルは encodeCursor の出力をそのまま返してもらう前提のため、拒否を期待値とした（確認事項 1） |
| TC-UT_LIB-006 | decodeCursor | 異常系 | 同値分割 | 空白・改行を含むカーソルは受け付けない | なし | cursor = "WyJh Il0"、"WyJhIl0\n" | どちらも AppError、code VALIDATION_ERROR、status 400 | B1-F, B2-T | なし | なし |  | TC-UT_LIB-006 空白・改行を含むカーソルは 400 VALIDATION_ERROR になる |  |
| TC-UT_LIB-007 | decodeCursor | 異常系 | 境界値 | Base64URL の字だけだが、長さが 4n+1 で復号すると空になるカーソルは JSON として読めず 400 になる | なし | cursor = "a" | AppError、code VALIDATION_ERROR、status 400 | B1-F, B2-F, B3-T | なし | なし |  | TC-UT_LIB-007 復号すると空になる 1 字のカーソルは 400 VALIDATION_ERROR になる |  |
| TC-UT_LIB-008 | decodeCursor | 異常系 | 同値分割 | JSON の null（配列でない値のうち、typeof が object のもの）は 400 になる | なし | cursor = "bnVsbA"（'null' の Base64URL） | AppError、code VALIDATION_ERROR、status 400 | B1-F, B2-F, B3-F, B4-T | なし | なし（DEV-02 はオブジェクトだけ） |  | TC-UT_LIB-008 JSON の null は 400 VALIDATION_ERROR になる |  |
| TC-UT_LIB-009 | decodeCursor | 異常系 | 同値分割 | 配列の要素に文字列でないもの（入れ子の配列・null）があれば 400 になる | なし | cursor = '[["a"]]' の Base64URL、'["a",null]' の Base64URL | どちらも AppError、code VALIDATION_ERROR、status 400 | B1-F, B2-F, B3-F, B4-F, B5-T | なし | 一部 TC-NOUS56_DEV-02（数値の要素だけ） |  | TC-UT_LIB-009 文字列でない要素を含む配列は 400 VALIDATION_ERROR になる |  |
| TC-UT_LIB-010 | decodeCursor | 異常系 | エラー処理 | どの分岐で落ちても、画面に出す項目のエラー（fields.cursor）が同じ文言になる | なし | B1・B2・B3・B4・B5 で落ちる代表値を1つずつ（""、"WyJhIl0="、"a"、"bnVsbA"、'[1]' の Base64URL） | どれも fields.cursor が "カーソルが正しくありません"、message は VALIDATION_ERROR の既定の文言 | B1-T, B2-T, B3-T, B4-T, B5-T | なし | 一部 TC-NOUS56_DEV-02（fields.cursor が空でないことだけ） |  | TC-UT_LIB-010 どの分岐で落ちても fields.cursor は同じ文言になる | 文言は実装の値。設計書は fields.cursor を返すことまでを決めている |

## 3. 確認事項・バグの疑い

- 確認事項 1：設計書（admin_auth 4章）はパディング付きの Base64URL の扱いを決めていない。encodeCursor の出力だけが渡る前提で、拒否を期待値にした（TC-UT_LIB-005）。
- 確認事項 2：decodeCursor と、呼び出し側の Zod（auditRoutes の cursor: z.string()）にカーソルの長さの上限がない。長い文字列でも復号と JSON.parse を行う。観察 API も同じ関数を使うため、上限を設けるかは観察サーバーの観点（NOUS-105）とあわせて確認する。バグの疑いではなく確認事項として扱う。
