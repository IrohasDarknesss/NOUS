# 単体テスト観点表：管理画面の枠と共通部品（apps/admin/src の layout・shared）

| 項目 | 内容 |
|---|---|
| 関連チケット | NOUS-99 |
| 作成者 | Mark Zuckerberg（開発担当） |
| 作成日 | 2026-10-26 |
| 対象 | apps/admin/src/layout/AdminLayout.tsx, apps/admin/src/layout/AdminHeader.tsx, apps/admin/src/layout/AdminSideMenu.tsx, apps/admin/src/layout/WorldStateBadge.tsx, apps/admin/src/layout/worldTime.ts, apps/admin/src/shared/useApiErrorHandler.ts, apps/admin/src/shared/ErrorContext.tsx, apps/admin/src/shared/ErrorModal.tsx, apps/admin/src/shared/ErrorBanner.tsx, apps/admin/src/shared/FieldError.tsx, apps/admin/src/shared/ConfirmDialog.tsx, apps/admin/src/shared/Toast.tsx, apps/admin/src/shared/Modal.tsx, apps/admin/src/shared/NumberField.tsx, apps/admin/src/shared/TextField.tsx, apps/admin/src/shared/SelectField.tsx, apps/admin/src/shared/DataTable.tsx |
| 言語 / フレームワーク | TypeScript / Vitest 2.1.9（environment: jsdom、Testing Library） |
| テストファイル | apps/admin/src/layout/layout.test.tsx（実装時、NOUS-50）, apps/admin/src/shared/shared.test.tsx（実装時、NOUS-50）, apps/admin/src/layout/layout.ut.test.tsx（単体テストで追加）, apps/admin/src/shared/shared.ut.test.tsx（単体テストで追加） |
| 外部依存 | fetch（mockFetch）, TanStack Query, React Router, setTimeout（Toast。vi.useFakeTimers） |
| 入力にした設計書 | FE 詳細設計 admin_control 2章（コンポーネント）・3章・4章 useApiErrorHandler・formatStopReason・6章（エラーの様式）, 画面基本設計書 P202 A01〜A04（サイドメニュー・バッジ・世界内時間・ログアウト）、基本設計書（概要）3章（世界内時間の表し方） |

このファイルは `docs/test/unit/_build/build_matrix.py` で JSON から作る。直すときは JSON を直して作り直す。

## 1. 分岐の一覧

| ID | 条件 | 場所 |
|---|---|---|
| B1 | formatWorldTime：負の秒を 0 にする（Math.max） | layout/worldTime.ts:3 |
| B2 | formatStopReason：stopReason がない | layout/WorldStateBadge.tsx:23 |
| B3 | formatStopReason：知らない理由（?? stopReason） | layout/WorldStateBadge.tsx:24 |
| B4 | WorldStateBadge：上限停止なら理由を添える | layout/WorldStateBadge.tsx:33 |
| B5 | AdminHeader：世界の状態を取得済み | layout/AdminHeader.tsx:29 |
| B6 | AdminLayout：閉じた様式①の移動先が /login（セッションを捨てる） | layout/AdminLayout.tsx:19 |
| B7 | AdminSideMenu：現在の画面（isActive） | layout/AdminSideMenu.tsx:31-34 |
| B8 | useApiErrorHandler：ApiError | shared/useApiErrorHandler.ts:33 |
| B9 | useApiErrorHandler：401 | shared/useApiErrorHandler.ts:34 |
| B10 | useApiErrorHandler：403 かつ CSRF_INVALID | shared/useApiErrorHandler.ts:38 |
| B11 | useApiErrorHandler：409 | shared/useApiErrorHandler.ts:42 |
| B12 | useApiErrorHandler：conflictMessage が関数 | shared/useApiErrorHandler.ts:44-45 |
| B13 | useApiErrorHandler：conflictMessage がない（?? error.message） | shared/useApiErrorHandler.ts:46 |
| B14 | useApiErrorHandler：400 | shared/useApiErrorHandler.ts:51 |
| B15 | useApiErrorHandler：fields に項目がある | shared/useApiErrorHandler.ts:52-53 |
| B16 | useApiErrorHandler：500 以上 | shared/useApiErrorHandler.ts:56 |
| B17 | useApiErrorHandler：NetworkError | shared/useApiErrorHandler.ts:64 |
| B18 | useApiErrorHandler：AbortError | shared/useApiErrorHandler.ts:68 |
| B19 | ErrorModal：message がない（出さない） | shared/ErrorModal.tsx:13 |
| B20 | ErrorModal：redirectTo がある | shared/ErrorModal.tsx:17 |
| B21 | ErrorBanner：message がない（出さない） | shared/ErrorBanner.tsx:10 |
| B22 | ErrorBanner：onClose がある（閉じるボタン） | shared/ErrorBanner.tsx:24 |
| B23 | FieldError：message がない（出さない） | shared/FieldError.tsx:10 |
| B24 | TextField：hideCount | shared/TextField.tsx:56 |
| B25 | TextField：文字数が maxLength を超える | shared/TextField.tsx:57 |
| B26 | TextField：multiline | shared/TextField.tsx:62 |
| B27 | DataTable：行が 0 件 | shared/DataTable.tsx:46 |
| B28 | DataTable：onRowClick がある | shared/DataTable.tsx:56-57 |
| B29 | NumberField・TextField：error がある（aria-invalid） | shared/NumberField.tsx:36、shared/TextField.tsx:44 |

## 2. ケースの一覧（33 件。うち新しく足したもの 20 件）

| ID | 対象 | 分類 | 技法 | 観点 | 前提 | 入力 | 期待結果 | 分岐 | モック | 既存テストとの対応 | バグの疑い | テスト名 | 備考 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| TC-NOUS50_DEV-18 | formatWorldTime | 正常系 | 開発者テスト | 世界内時間を「第 N 日 HH:MM」にする | なし | 0、86,399、86,400、7,260 | 第 1 日 00:00、第 1 日 23:59、第 2 日 00:00、第 1 日 02:01 | B1-F | なし | 実装時のテスト（NOUS-50） |  | TC-NOUS50_DEV-18 世界内時間を「第 N 日 HH:MM」にする |  |
| TC-NOUS50_DEV-19 | formatStopReason | 正常系 | 開発者テスト | 停止理由を日本語にする | なし | 5 つの理由と null | 各日本語、null は空 | B2-T, B2-F, B3-F | なし | 実装時のテスト（NOUS-50） |  | TC-NOUS50_DEV-19 停止理由を日本語にする |  |
| TC-NOUS50_DEV-20 | WorldStateBadge | 正常系 | 開発者テスト | 状態の色と、上限停止のときは理由を出す | なし | limit_stopped・runs_limit | 「上限停止（生成の回数の上限）」、背景 #EA580C | B4-T | なし | 実装時のテスト（NOUS-50） |  | TC-NOUS50_DEV-20 WorldStateBadge は状態の色と、上限停止のときは理由を出す |  |
| TC-NOUS50_DEV-21 | ErrorBanner / FieldError | 正常系 | 開発者テスト | message がなければ何も出さない | なし | ErrorBanner null、FieldError 引数なし、その後 ErrorBanner に文言 | 何も出さない、文言の alert | B21-T, B21-F, B22-F, B23-T | なし | 実装時のテスト（NOUS-50） |  | TC-NOUS50_DEV-21 ErrorBanner・FieldError は message がなければ何も出さない |  |
| TC-NOUS50_DEV-22 | ConfirmDialog | 正常系 | 開発者テスト | 確定とキャンセルを呼び分け、送信中は押せない | なし | 確定・キャンセル | onConfirm・onCancel を呼び分け、送信中は disabled |  | なし | 実装時のテスト（NOUS-50） |  | TC-NOUS50_DEV-22 ConfirmDialog は確定とキャンセルを呼び分け、送信中は押せない |  |
| TC-NOUS50_DEV-23 | ToastProvider | 正常系 | 開発者テスト | トーストは 4 秒で消える | vi.useFakeTimers | showToast | 4 秒後に消える |  | vi.useFakeTimers | 実装時のテスト（NOUS-50） |  | TC-NOUS50_DEV-23 トーストは 4 秒で消える |  |
| TC-NOUS50_DEV-24 | DataTable | 正常系 | 開発者テスト | 0 件で emptyMessage、行を押すと onRowClick | なし | rows 0 件と 1 件 | emptyMessage、onRowClick が呼ばれる | B27-T, B27-F, B28-T | なし | 実装時のテスト（NOUS-50） |  | TC-NOUS50_DEV-24 DataTable は 0 件で emptyMessage、行を押すと onRowClick |  |
| TC-NOUS50_DEV-25 | TextField | 正常系 | 開発者テスト | 文字数を出し、error を入力欄の下に出す | なし | value・maxLength・error | 「n/max」と error の文言 | B24-F, B25-F, B26-F, B29-T, B23-F | なし | 実装時のテスト（NOUS-50） |  | TC-NOUS50_DEV-25 TextField は文字数を出し、error を入力欄の下に出す |  |
| TC-NOUS50_DEV-26 | useApiErrorHandler | 異常系 | 開発者テスト | 401 は様式①（ログインの有効期限）で、OK の後に /login | SessionProvider・ErrorProvider | ApiError(401) | modal { 有効期限の文言, redirectTo /login } | B8-T, B9-T | fetch を mockFetch で差し替え | 実装時のテスト（NOUS-50） |  | TC-NOUS50_DEV-26 401 は様式①（ログインの有効期限）で、OK の後に /login |  |
| TC-NOUS50_DEV-27 | useApiErrorHandler | 異常系 | 開発者テスト | 409 は様式②に画面の文言を出し、指定のクエリを再取得する | 同上 | ApiError(409)、conflictMessage は文字列、invalidateKeys | banner に画面の文言、invalidateQueries | B9-F, B10-F, B11-T, B12-F, B13-F | fetch を mockFetch で差し替え | 実装時のテスト（NOUS-50） |  | TC-NOUS50_DEV-27 409 は様式②に画面の文言を出し、指定のクエリを再取得する |  |
| TC-NOUS50_DEV-28 | useApiErrorHandler | 異常系 | 開発者テスト | 400 は fields を返し、fields がなければ _form に message | 同上 | ApiError(400) fields あり・なし | fields、{ _form: message } | B11-F, B14-T, B15-T, B15-F | fetch を mockFetch で差し替え | 実装時のテスト（NOUS-50） |  | TC-NOUS50_DEV-28 400 は fields を返し、fields がなければ _form に message |  |
| TC-NOUS50_DEV-29 | useApiErrorHandler | 異常系 | 開発者テスト | 500 と通信の失敗は様式① | 同上 | ApiError(500)、NetworkError | modal 操作に失敗しました… | B14-F, B16-T, B8-F, B17-T | fetch を mockFetch で差し替え | 実装時のテスト（NOUS-50） |  | TC-NOUS50_DEV-29 500 と通信の失敗は様式① |  |
| TC-NOUS50_DEV-30 | useApiErrorHandler | 異常系 | 開発者テスト | 403 CSRF_INVALID はセッションを取り直してから様式②「操作をやり直してください」 | 同上 | ApiError(403, CSRF_INVALID) | GET session の後に banner | B10-T | fetch を mockFetch で差し替え | 実装時のテスト（NOUS-50） |  | TC-NOUS50_DEV-30 403 CSRF_INVALID はセッションを取り直してから様式②「操作をやり直してください」 |  |
| TC-UT_AWEB-021 | formatWorldTime | 異常系 | 境界値 | 世界内時間は負なら 0 として扱い、秒の端数と 1 分未満は切り捨てる | なし | -5、59.9、3,599、3,600 | 第 1 日 00:00、第 1 日 00:00、第 1 日 00:59、第 1 日 01:00 | B1-T, B1-F | なし | 一部 TC-NOUS50_DEV-18（0 以上の整数だけ） |  | TC-UT_AWEB-021 世界内時間は負なら 0 として扱い、秒の端数と 1 分未満は切り捨てる |  |
| TC-UT_AWEB-022 | formatStopReason | 異常系 | 同値分割 | 知らない理由をそのまま返し、undefined は空にする | なし | "maintenance"、undefined | "maintenance"、"" | B3-T, B2-T | なし | 一部 TC-NOUS50_DEV-19（既知の 5 つと null） |  | TC-UT_AWEB-022 formatStopReason は知らない理由をそのまま返し、undefined は空にする | 知らない理由の扱いは設計書に記載なし。実装の値 |
| TC-UT_AWEB-023 | WorldStateBadge | 正常系 | 分岐網羅 | 上限停止以外では停止理由を添えない | なし | paused・manual_pause、emergency_stopped・emergency | 「一時停止」「緊急停止」だけで（）を付けない | B4-F | なし | 一部 TC-NOUS50_DEV-20（上限停止だけ） |  | TC-UT_AWEB-023 WorldStateBadge は上限停止以外では停止理由を添えない |  |
| TC-UT_AWEB-024 | AdminSideMenu | 正常系 | 同値分割 | /agents で「エージェント」だけを現在の画面にし、「実行制御」（/）は強調しない | セッション 200、world 200 | /agents を開く | /agents のリンクに aria-current=page、/ のリンクには付けない | B7-T, B7-F | fetch を mockFetch で差し替え、renderApp（createMemoryRouter と QueryClient） | 一部 TC-NOUS50_DEV-17（/settings で、/ の end を見ていない） |  | TC-UT_AWEB-024 サイドメニューは /agents で「エージェント」だけを現在の画面にし、「実行制御」（/）は強調しない |  |
| TC-UT_AWEB-025 | AdminHeader | 正常系 | 分岐網羅 | 世界の状態の取得中に「状態を取得しています…」を出し、ログインした管理者の表示名を出す | セッション 200、GET world は返らない | / を開く | 「状態を取得しています…」と「Kaine Yamashiro」 | B5-F | fetch を vi.stubGlobal（world は返らない Promise）、renderApp | なし（DEV-15 は取得済みのときだけ） |  | TC-UT_AWEB-025 ヘッダーは世界の状態の取得中に「状態を取得しています…」を出し、ログインした管理者の表示名を出す |  |
| TC-UT_AWEB-026 | AdminLayout / useApiErrorHandler | 異常系 | 状態遷移 | 画面の API が 401 なら様式①を出し、OK でセッションを捨てて /login の画面に移る | セッション 200、GET settings 401 | /settings を開き、OK を押す | 有効期限の文言のモーダル、OK の後に /login で P201 を表示 | B5-T, B6-T, B8-T, B9-T, B19-F, B20-T | fetch を mockFetch で差し替え、renderApp（createMemoryRouter と QueryClient） | 一部 TC-NOUS50_DEV-26（modal の状態だけで、移動とセッションの破棄は見ていない） |  | TC-UT_AWEB-026 画面の API が 401 なら様式①を出し、OK でセッションを捨てて /login の画面に移る |  |
| TC-UT_AWEB-027 | useApiErrorHandler | 異常系 | 分岐網羅 | 409 で conflictMessage が関数ならエラーから文言を作り、指定がなければサーバーの message を様式②に出す | SessionProvider・ErrorProvider | ApiError(409, NO_AGENTS) と関数、ApiError(409, STATE_CONFLICT) と ctx なし | 「画面:NO_AGENTS」、その後「server-conflict」、invalidateQueries は呼ばない | B11-T, B12-T, B13-T | fetch を mockFetch で差し替え | 一部 TC-NOUS50_DEV-27（文字列の文言だけ） |  | TC-UT_AWEB-027 409 で conflictMessage が関数ならエラーから文言を作り、指定がなければサーバーの message を様式②に出す |  |
| TC-UT_AWEB-028 | useApiErrorHandler | 異常系 | 同値分割 | 画面で扱わない 4xx（404・429）はサーバーの message を様式②に出す | 同上 | ApiError(404)、ApiError(429) | banner に server-404・server-429、modal は出さない | B9-F, B10-F, B11-F, B14-F, B16-F | fetch を mockFetch で差し替え | なし |  | TC-UT_AWEB-028 画面で扱わない 4xx（404・429）はサーバーの message を様式②に出す | 設計書 4章に 404・429 の記載なし。実装の値 |
| TC-UT_AWEB-029 | useApiErrorHandler | 異常系 | 分岐網羅 | AbortError は何も出さず、ApiError・NetworkError 以外の例外は様式①にする | 同上 | DOMException(AbortError)、Error | AbortError は banner・modal とも null、Error は modal 操作に失敗しました… | B8-F, B17-F, B18-T, B18-F | fetch を mockFetch で差し替え | なし |  | TC-UT_AWEB-029 AbortError は何も出さず、ApiError・NetworkError 以外の例外は様式①にする |  |
| TC-UT_AWEB-030 | useApiErrorHandler | 異常系 | 境界値 | 400 で fields が空のオブジェクトなら、_form に message を入れて返す | 同上 | ApiError(400, VALIDATION_ERROR, "入力の内容を確認してください", {}) | { _form: "入力の内容を確認してください" } | B14-T, B15-F | fetch を mockFetch で差し替え | 一部 TC-NOUS50_DEV-28（fields が undefined のとき） |  | TC-UT_AWEB-030 400 で fields が空のオブジェクトなら、_form に message を入れて返す |  |
| TC-UT_AWEB-031 | useErrorState | 正常系 | 同値分割 | ErrorProvider の外では、様式の表示の関数を呼んでも何もせず例外にしない | なし（Provider の外） | showBanner・showModal | 例外にならない、banner は null |  | なし | なし |  | TC-UT_AWEB-031 ErrorProvider の外では、様式の表示の関数を呼んでも何もせず例外にしない | LoginPage は AdminLayout の外で使うため |
| TC-UT_AWEB-032 | ErrorModal | 正常系 | 分岐網羅 | redirectTo がなければ OK で閉じるだけで移動しない | /settings | message あり、redirectTo なし、OK | onClose 1 回、/login に移らない | B19-F, B20-F | MemoryRouter | 一部 TC-NOUS50_DEV-26（redirectTo ありの状態だけ） |  | TC-UT_AWEB-032 ErrorModal は redirectTo がなければ OK で閉じるだけで移動しない |  |
| TC-UT_AWEB-033 | ErrorBanner | 正常系 | 分岐網羅 | onClose があれば閉じるボタンを出して呼び、なければボタンを出さない | なし | onClose あり → なし | 1 回呼ぶ、なしではボタンなし | B22-T, B22-F | なし | 一部 TC-NOUS50_DEV-21（onClose なしだけ） |  | TC-UT_AWEB-033 ErrorBanner は onClose があれば閉じるボタンを出して呼び、なければボタンを出さない |  |
| TC-UT_AWEB-034 | ToastProvider | 正常系 | 境界値 | トーストを 2 秒ずらして 2 つ出すと、それぞれ 4 秒で別々に消える | vi.useFakeTimers | 0 秒に 1つ目、2 秒に 2つ目、4 秒と 6 秒で確かめる | 4 秒で 2つ目だけ残り、6 秒で 0 件 |  | vi.useFakeTimers | 一部 TC-NOUS50_DEV-23（1 つだけ） |  | TC-UT_AWEB-034 トーストを 2 秒ずらして 2 つ出すと、それぞれ 4 秒で別々に消える |  |
| TC-UT_AWEB-035 | NumberField | 正常系 | 同値分割 | 範囲と単位を出し、入力値を文字列のまま返し、error のときは aria-invalid を付ける | なし | label 周期（分）、15〜120、unit 分、error あり、"7" を入力 | 「15〜120」「分」、onChange("7")、aria-invalid=true | B29-T | なし | なし |  | TC-UT_AWEB-035 NumberField は範囲と単位を出し、入力値を文字列のまま返し、error のときは aria-invalid を付ける |  |
| TC-UT_AWEB-036 | TextField | 正常系 | 境界値 | 文字数をコードポイントで数え、上限を超えた数も出し、hideCount なら数を出さない | なし | value "😀a"、maxLength 1、hideCount なし → あり | 「2/1」、hideCount では出さない | B24-T, B24-F, B25-T, B29-F | なし | 一部 TC-NOUS50_DEV-25（上限の中の ASCII だけ） |  | TC-UT_AWEB-036 TextField は文字数をコードポイントで数え、上限を超えた数も出し、hideCount なら数を出さない |  |
| TC-UT_AWEB-037 | SelectField | 正常系 | 同値分割 | 選択肢を出し、選んだ値を onChange に渡す | なし | options A・B、b を選ぶ | option は [A, B]、onChange("b") |  | なし | なし |  | TC-UT_AWEB-037 SelectField は選択肢を出し、選んだ値を onChange に渡す |  |
| TC-UT_AWEB-038 | AdminLayout | 異常系 | 分岐網羅 | 移動先のない様式①（500）は、OK で閉じてもセッションを捨てず、同じ画面に残る | セッション 200、GET settings 500 | /settings を開き、OK を押す | モーダルが消え、/settings のまま、ログアウトのボタン（ヘッダー）がある | B6-F, B20-F, B19-T | fetch を mockFetch で差し替え、renderApp（createMemoryRouter と QueryClient） | なし |  | TC-UT_AWEB-038 移動先のない様式①（500）は、OK で閉じてもセッションを捨てず、同じ画面に残る |  |
| TC-UT_AWEB-039 | TextField | 正常系 | 分岐網羅 | multiline なら textarea を rows の行数で出す | なし | multiline、rows 5 | TEXTAREA、rows=5 | B26-T | なし | なし |  | TC-UT_AWEB-039 TextField は multiline なら textarea を rows の行数で出す |  |
| TC-UT_AWEB-040 | DataTable | 正常系 | 分岐網羅 | onRowClick がなければ行を押せる見た目にせず、押しても何も起きない | なし | rows 1 件、onRowClick なし、行を押す | 行の cursor は空、例外なし | B28-F | なし | 一部 TC-NOUS50_DEV-24（onRowClick ありだけ） |  | TC-UT_AWEB-040 DataTable は onRowClick がなければ行を押せる見た目にせず、押しても何も起きない |  |

## 3. 確認事項・バグの疑い

- 確認事項 1：ConfirmDialog の送信中の再送の防止（ConfirmDialog.tsx:27 の if (submitting) return）は、送信中はボタンを disabled にするため画面の操作では通らない。TC-NOUS50_DEV-22 で、送信中にボタンが押せないことだけを確かめている。分岐の一覧からは外した
- 確認事項 2：色・余白・danger のボタンの色などの見た目は、README 6.5 のとおり単体テストの対象にしない（ST の UI レビューで見る）
