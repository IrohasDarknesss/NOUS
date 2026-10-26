# 単体テスト観点表：管理画面の API クライアント・セッション・ルーティング（apps/admin/src の api・session・router・main・App）

| 項目 | 内容 |
|---|---|
| 関連チケット | NOUS-99 |
| 作成者 | Mark Zuckerberg（開発担当） |
| 作成日 | 2026-10-26 |
| 対象 | apps/admin/src/api/client.ts, apps/admin/src/api/session.ts, apps/admin/src/api/world.ts, apps/admin/src/api/settings.ts, apps/admin/src/session/SessionProvider.tsx, apps/admin/src/session/RequireSession.tsx, apps/admin/src/session/csrfToken.ts, apps/admin/src/router.tsx, apps/admin/src/main.tsx, apps/admin/src/App.tsx |
| 言語 / フレームワーク | TypeScript / Vitest 2.1.9（environment: jsdom、Testing Library） |
| テストファイル | apps/admin/src/api/client.test.ts（実装時、NOUS-50）, apps/admin/src/router.test.tsx（実装時、NOUS-50）, apps/admin/src/App.test.tsx（実装時、NOUS-42）, apps/admin/src/api/api.ut.test.tsx（単体テストで追加）, apps/admin/src/session/session.ut.test.tsx（単体テストで追加）, apps/admin/src/router.ut.test.tsx（単体テストで追加） |
| 外部依存 | fetch（mockFetch・vi.stubGlobal で差し替え）, TanStack Query（createTestQueryClient）, React Router（createMemoryRouter・MemoryRouter）, localStorage・sessionStorage（jsdom） |
| 入力にした設計書 | FE 詳細設計 admin_control 1章（ルーティング）・3章（状態管理）・4章 adminFetch・getCsrfToken・bootstrapSession・login・logout・useAdminWorld・6章, 画面基本設計書 P201（業務ルール：パスワード・CSRF トークンを保存しない）, BE 詳細設計 world 2章・admin_auth 2章（API のパス） |

このファイルは `docs/test/unit/_build/build_matrix.py` で JSON から作る。直すときは JSON を直して作り直す。

## 1. 分岐の一覧

| ID | 条件 | 場所 |
|---|---|---|
| B1 | adminFetch：body がある（Content-Type を付ける） | api/client.ts:56 |
| B2 | adminFetch：CSRF を付ける（options.csrf ?? method !== 'GET'） | api/client.ts:57-58 |
| B3 | adminFetch：手元に CSRF トークンがある | api/client.ts:60 |
| B4 | adminFetch：fetch の例外が AbortError | api/client.ts:72-73 |
| B5 | adminFetch：status 204 | api/client.ts:77 |
| B6 | adminFetch：res.ok（2xx） | api/client.ts:80 |
| B7 | adminFetch：2xx で本文が読めない（data が undefined） | api/client.ts:81 |
| B8 | adminFetch：本文が API のエラーの形（error.code がある） | api/client.ts:38・85 |
| B9 | adminFetch：401 かつ ADMIN_UNAUTHORIZED（CSRF トークンを捨てる） | api/client.ts:88 |
| B10 | adminFetch：エラーの形でない応答で status >= 500 | api/client.ts:91 |
| B11 | readJson：本文が空 | api/client.ts:45 |
| B12 | readJson：JSON.parse の例外 | api/client.ts:48 |
| B13 | useAdminWorld：取得の失敗（isError） | api/world.ts:63 |
| B14 | useAdminWorld：失敗が 3 回目（様式②を出す） | api/world.ts:65 |
| B15 | useAdminWorld：成功で失敗の回数を 0 に戻す | api/world.ts:66 |
| B16 | bootstrapSession：GET /admin/api/session が成功 | session/SessionProvider.tsx:47-55 |
| B17 | bootstrapSession：409 ADMIN_NOT_SET | session/SessionProvider.tsx:58 |
| B18 | bootstrapSession：401（bootstrapFailed を立てない） | session/SessionProvider.tsx:62-63 |
| B19 | signOut：logout の失敗を握りつぶす | session/SessionProvider.tsx:81 |
| B20 | useSession：SessionProvider の外 | session/SessionProvider.tsx:102 |
| B21 | RequireSession：status が loading | session/RequireSession.tsx:16 |
| B22 | RequireSession：status が ready でない（/login へ） | session/RequireSession.tsx:19 |
| B23 | loginPathFor：移動先が /（next を付けない） | session/RequireSession.tsx:9 |

## 2. ケースの一覧（38 件。うち新しく足したもの 20 件）

| ID | 対象 | 分類 | 技法 | 観点 | 前提 | 入力 | 期待結果 | 分岐 | モック | 既存テストとの対応 | バグの疑い | テスト名 | 備考 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| TC-NOUS50_DEV-01 | adminFetch | 正常系 | 開発者テスト | GET には X-CSRF-Token を付けず、credentials は same-origin | CSRF トークン csrf-abc | GET /admin/api/world | X-CSRF-Token なし、credentials same-origin、本文を返す | B1-F, B2-F, B6-T, B7-F, B11-F, B12-F | fetch を mockFetch で差し替え | 実装時のテスト（NOUS-50） |  | TC-NOUS50_DEV-01 GET には X-CSRF-Token を付けず、credentials は same-origin |  |
| TC-NOUS50_DEV-02 | adminFetch | 正常系 | 開発者テスト | GET 以外には X-CSRF-Token と Content-Type を付け、本文を JSON にする | CSRF トークン csrf-abc | POST /admin/api/world/reset、本文 { confirmName } | X-CSRF-Token csrf-abc、Content-Type application/json、本文は JSON | B1-T, B2-T, B3-T | fetch を mockFetch で差し替え | 実装時のテスト（NOUS-50） |  | TC-NOUS50_DEV-02 GET 以外には X-CSRF-Token と Content-Type を付け、本文を JSON にする |  |
| TC-NOUS50_DEV-03 | adminFetch | 正常系 | 開発者テスト | csrf: false なら POST でも X-CSRF-Token を付けない（login） | CSRF トークンあり | POST /admin/api/login、csrf: false | X-CSRF-Token なし | B2-F | fetch を mockFetch で差し替え | 実装時のテスト（NOUS-50） |  | TC-NOUS50_DEV-03 csrf: false なら POST でも X-CSRF-Token を付けない（login） |  |
| TC-NOUS50_DEV-04 | adminFetch | 正常系 | 開発者テスト | 204 は undefined を返す | なし | POST /admin/api/logout → 204 | undefined | B5-T | fetch を mockFetch で差し替え | 実装時のテスト（NOUS-50） |  | TC-NOUS50_DEV-04 204 は undefined を返す |  |
| TC-NOUS50_DEV-05 | adminFetch | 異常系 | 開発者テスト | 2xx 以外は本文の error から ApiError（status・code・message・fields）にする | なし | 400 VALIDATION_ERROR と fields | ApiError の status・code・message・fields | B5-F, B6-F, B8-T | fetch を mockFetch で差し替え | 実装時のテスト（NOUS-50） |  | TC-NOUS50_DEV-05 2xx 以外は本文の error から ApiError（status・code・message・fields）にする |  |
| TC-NOUS50_DEV-06 | adminFetch | 異常系 | 開発者テスト | 401 ADMIN_UNAUTHORIZED では手元の CSRF トークンを捨てる | CSRF トークンあり | 401 ADMIN_UNAUTHORIZED | ApiError、getCsrfToken() は null | B9-T | fetch を mockFetch で差し替え | 実装時のテスト（NOUS-50） |  | TC-NOUS50_DEV-06 401 ADMIN_UNAUTHORIZED では手元の CSRF トークンを捨てる |  |
| TC-NOUS50_DEV-07 | adminFetch | 異常系 | 開発者テスト | 401 LOGIN_FAILED では CSRF トークンを捨てない | CSRF トークンあり | 401 LOGIN_FAILED | ApiError、トークンは残る | B9-F | fetch を mockFetch で差し替え | 実装時のテスト（NOUS-50） |  | TC-NOUS50_DEV-07 401 LOGIN_FAILED では CSRF トークンを捨てない |  |
| TC-NOUS50_DEV-08 | adminFetch | 異常系 | 開発者テスト | 通信の失敗は NetworkError、本文が JSON でない 500 は INTERNAL_ERROR の ApiError | なし | fetch が TypeError、500 で本文が JSON でない | NetworkError、ApiError(500, INTERNAL_ERROR) | B4-F, B12-T, B8-F, B10-T | fetch を mockFetch で差し替え | 実装時のテスト（NOUS-50） |  | TC-NOUS50_DEV-08 通信の失敗は NetworkError、本文が JSON でない 500 は INTERNAL_ERROR の ApiError |  |
| TC-NOUS50_DEV-09 | router | 正常系 | 開発者テスト | 認証が要る画面は 10 画面・11 ルート（P204 は新規と編集）が登録されている | なし | protectedRoutes | 11 ルート |  | なし | 実装時のテスト（NOUS-50） |  | TC-NOUS50_DEV-09 認証が要る画面は 10 画面・11 ルート（P204 は新規と編集）が登録されている |  |
| TC-NOUS50_DEV-10 | router | 正常系 | 開発者テスト | ログイン済みなら各パスで対応する画面を表示する | セッション 200 | / ・/agents など 11 のパス | 各画面の ID を表示 | B16-T, B21-F, B22-F | fetch を mockFetch で差し替え、renderApp（createMemoryRouter と QueryClient） | 実装時のテスト（NOUS-50） |  | TC-NOUS50_DEV-10 ログイン済みなら %s で %s を表示する |  |
| TC-NOUS50_DEV-11 | router | 正常系 | 開発者テスト | /login は認証なしで P201 を表示する | セッション 401 | /login | P201 を表示 | B18-T | fetch を mockFetch で差し替え、renderApp（createMemoryRouter と QueryClient） | 実装時のテスト（NOUS-50） |  | TC-NOUS50_DEV-11 /login は認証なしで P201 を表示する |  |
| TC-NOUS50_DEV-12 | router / RequireSession | 異常系 | 開発者テスト | 未ログインで認証が要る画面を開くと /login?next=… へ移る | セッション 401 | /settings など | /login?next=… | B16-F, B22-T, B23-F | fetch を mockFetch で差し替え、renderApp（createMemoryRouter と QueryClient） | 実装時のテスト（NOUS-50） |  | TC-NOUS50_DEV-12 未ログインで認証が要る画面を開くと /login?next=… へ移る |  |
| TC-NOUS50_DEV-13 | router / bootstrapSession | 異常系 | 開発者テスト | パスワード未設定（409 ADMIN_NOT_SET）でも /login へ移る | セッション 409 ADMIN_NOT_SET | / | /login | B17-T, B22-T, B23-T | fetch を mockFetch で差し替え、renderApp（createMemoryRouter と QueryClient） | 実装時のテスト（NOUS-50） |  | TC-NOUS50_DEV-13 パスワード未設定（409 ADMIN_NOT_SET）でも /login へ移る |  |
| TC-NOUS50_DEV-14 | router | 異常系 | 開発者テスト | 未知のパスは / へ戻す | セッション 200 | /unknown | / |  | fetch を mockFetch で差し替え、renderApp（createMemoryRouter と QueryClient） | 実装時のテスト（NOUS-50） |  | TC-NOUS50_DEV-14 未知のパスは / へ戻す |  |
| TC-NOUS50_DEV-15 | AdminHeader / signOut | 正常系 | 開発者テスト | ヘッダーに世界の状態と世界内時間、ログアウトで /login へ移る | セッション 200、world 200、logout 204 | ログアウトを押す | バッジと世界内時間、/login | B19-F | fetch を mockFetch で差し替え、renderApp（createMemoryRouter と QueryClient） | 実装時のテスト（NOUS-50） |  | TC-NOUS50_DEV-15 ヘッダーに世界の状態と世界内時間、ログアウトで /login へ移る |  |
| TC-NOUS50_DEV-16 | signOut | 異常系 | 開発者テスト | ログアウトの API が失敗しても /login へ移る | logout 500 | ログアウトを押す | /login | B19-T | fetch を mockFetch で差し替え、renderApp（createMemoryRouter と QueryClient） | 実装時のテスト（NOUS-50） |  | TC-NOUS50_DEV-16 ログアウトの API が失敗しても /login へ移る |  |
| TC-NOUS50_DEV-17 | AdminSideMenu | 正常系 | 開発者テスト | サイドメニューに 8 項目があり、現在のパスを強調する | セッション 200 | /settings | 8 項目、実行設定を強調 |  | fetch を mockFetch で差し替え、renderApp（createMemoryRouter と QueryClient） | 実装時のテスト（NOUS-50） |  | TC-NOUS50_DEV-17 サイドメニューに 8 項目があり、現在のパスを強調する |  |
| TC-NOUS42_DEV-04 | App | 正常系 | 開発者テスト | testing-library で描画できる（雛形） | なし | <App /> | 「NOUS admin」を表示 |  | なし | 実装時のテスト（NOUS-42） |  | TC-NOUS42_DEV-04 testing-library で描画できる |  |
| TC-UT_AWEB-001 | adminFetch | 異常系 | 分岐網羅 | 2xx で本文が空なら NetworkError（応答を読み取れませんでした）にする | なし | 200、本文なし | NetworkError、message「応答を読み取れませんでした」 | B5-F, B6-T, B7-T, B11-T | fetch を vi.stubGlobal で差し替え | なし（DEV は 2xx で本文があるときだけ） |  | TC-UT_AWEB-001 2xx で本文が空なら NetworkError（応答を読み取れませんでした）にする | FE 詳細設計に 2xx で本文がないときの記載なし。実装の値 |
| TC-UT_AWEB-002 | adminFetch | 異常系 | 分岐網羅 | 要求を abort したときは NetworkError にせず AbortError をそのまま投げる | なし | fetch が DOMException(AbortError) を投げる | DOMException（name AbortError） | B4-T | fetch を vi.stubGlobal で差し替え | 一部 TC-NOUS50_DEV-08（AbortError 以外の通信の失敗だけ） |  | TC-UT_AWEB-002 要求を abort したときは NetworkError にせず AbortError をそのまま投げる |  |
| TC-UT_AWEB-003 | adminFetch | 異常系 | 同値分割 | 4xx で本文が JSON でなければ、code UNKNOWN の ApiError にする | なし | 404、本文「Not Found」 | ApiError(404, UNKNOWN) | B8-F, B10-F, B12-T | fetch を vi.stubGlobal で差し替え | 一部 TC-NOUS50_DEV-08（500 だけ） |  | TC-UT_AWEB-003 4xx で本文が JSON でなければ、code UNKNOWN の ApiError にする |  |
| TC-UT_AWEB-004 | adminFetch | 異常系 | 分岐網羅 | 本文の error に code がなければ API のエラーの形とみなさない（400 は UNKNOWN） | なし | 400、本文 { error: "bad" } | ApiError(400, UNKNOWN)、fields なし | B8-F, B10-F | fetch を vi.stubGlobal で差し替え | なし |  | TC-UT_AWEB-004 本文の error に code がなければ API のエラーの形とみなさない（400 は UNKNOWN） |  |
| TC-UT_AWEB-005 | adminFetch | 正常系 | 分岐網羅 | 手元に CSRF トークンがなければ、POST でも X-CSRF-Token を付けない | CSRF トークン null | POST /admin/api/world/pause | X-CSRF-Token なし | B2-T, B3-F | fetch を mockFetch で差し替え | なし（DEV はトークンがあるときだけ） |  | TC-UT_AWEB-005 手元に CSRF トークンがなければ、POST でも X-CSRF-Token を付けない |  |
| TC-UT_AWEB-006 | adminFetch | 正常系 | 分岐網羅 | csrf: true なら GET でも X-CSRF-Token を付け、本文がなければ Content-Type を付けない | CSRF トークン csrf-abc | GET、csrf: true | X-CSRF-Token csrf-abc、Content-Type なし | B1-F, B2-T, B3-T | fetch を mockFetch で差し替え | 一部 TC-NOUS50_DEV-01・03（既定と false だけ） |  | TC-UT_AWEB-006 csrf: true なら GET でも X-CSRF-Token を付け、本文がなければ Content-Type を付けない |  |
| TC-UT_AWEB-007 | login / logout | 正常系 | 依存 | login は POST /admin/api/login に { password } を X-CSRF-Token なしで送り、logout は X-CSRF-Token を付けて送る | CSRF トークン csrf-abc | login("correct-horse-battery")、logout() | login は本文 { password }・トークンなし、logout は /admin/api/logout にトークンあり | B2-F, B2-T, B5-T | fetch を mockFetch で差し替え | 一部 TC-NOUS50_DEV-03（adminFetch の引数だけ） |  | TC-UT_AWEB-007 login は POST /admin/api/login に { password } を X-CSRF-Token なしで送り、logout は X-CSRF-Token を付けて送る |  |
| TC-UT_AWEB-008 | start / pause / resume / emergencyStop / reset | 正常系 | 依存 | 世界の操作の関数は、対応するパスに X-CSRF-Token を付けて POST する | CSRF トークン csrf-abc | 5 つの関数 | それぞれ /admin/api/world/start・pause・resume・emergency-stop・reset に POST、トークンあり | B2-T, B3-T | fetch を mockFetch で差し替え | なし（DEV は画面から一部だけ） |  | TC-UT_AWEB-008 世界の操作の関数は、対応するパスに X-CSRF-Token を付けて POST する |  |
| TC-UT_AWEB-009 | getAuditLogs | 正常系 | 同値分割 | getAuditLogs は既定で limit=10、引数を渡せばその件数で GET する | なし | getAuditLogs()、getAuditLogs(3) | ?limit=10、?limit=3 |  | fetch を mockFetch で差し替え | なし |  | TC-UT_AWEB-009 getAuditLogs は既定で limit=10、引数を渡せばその件数で GET する |  |
| TC-UT_AWEB-010 | getSettings / updateSettings | 正常系 | 依存 | getSettings は GET、updateSettings は本文つきで PUT し X-CSRF-Token を付ける | CSRF トークン csrf-abc | getSettings()、updateSettings({ cycleMinutes: 30 }) | GET、PUT と JSON の本文とトークン | B1-T, B2-T | fetch を mockFetch で差し替え | 一部 TC-NOUS69_DEV-22（画面から PUT を呼んだことだけ） |  | TC-UT_AWEB-010 getSettings は GET、updateSettings は本文つきで PUT し X-CSRF-Token を付ける |  |
| TC-UT_AWEB-011 | useAdminWorld | 異常系 | 境界値 | 取得が 2 回続けて失敗しても様式②を出さず、3 回目の失敗で「最新の状態を取得できていません」を出す | GET /admin/api/world が常に 500 | 最初の取得と refetchQueries 2 回 | 2 回目の後は banner null、3 回目の後に banner（取得中の最初の描画では回数を変えない） | B13-F, B15-F, B13-T, B14-F, B14-T | fetch を vi.stubGlobal、ErrorProvider、QueryClient の refetchQueries で取り直す | なし |  | TC-UT_AWEB-011 取得が 2 回続けて失敗しても様式②を出さず、3 回目の失敗で「最新の状態を取得できていません」を出す | 5 秒ごとの取得は実時間で待たず、refetchQueries で回数だけ進める |
| TC-UT_AWEB-012 | useAdminWorld | 正常系 | 分岐網羅 | 途中で 1 回成功すれば失敗の回数を数え直し、その後 2 回失敗しても様式②を出さない | 失敗・失敗・成功・失敗・失敗の順に応答 | 最初の取得と refetchQueries 4 回 | banner は null のまま | B13-T, B13-F, B15-T, B14-F | fetch を vi.stubGlobal、ErrorProvider、refetchQueries | なし |  | TC-UT_AWEB-012 途中で 1 回成功すれば失敗の回数を数え直し、その後 2 回失敗しても様式②を出さない |  |
| TC-UT_AWEB-013 | csrfToken | 正常系 | 同値分割 | CSRF トークンはメモリだけに置き、localStorage・sessionStorage に書かない | なし | setCsrfToken("csrf-memory-only") | getCsrfToken は同じ値、localStorage・sessionStorage にその値がない |  | なし | なし |  | TC-UT_AWEB-013 CSRF トークンはメモリだけに置き、localStorage・sessionStorage に書かない | P201 の業務ルール・FE 詳細設計 3章（保存しない） |
| TC-UT_AWEB-014 | SessionProvider（bootstrapSession） | 異常系 | 同値分割 | 起動時のセッションの取得が 401 なら未ログインだけ、通信の失敗なら bootstrapFailed も立てる | なし | GET /admin/api/session → 401、または fetch が TypeError | どちらも status unauthenticated・トークン null。bootstrapFailed は 401 で false、通信の失敗で true | B16-F, B17-F, B18-T, B18-F | fetch を mockFetch で差し替え（通信の失敗は vi.stubGlobal）、MemoryRouter | 一部 TC-NOUS50_DEV-11・12（401 の画面の遷移だけ） |  | TC-UT_AWEB-014 起動時のセッションの取得が 401 なら未ログインだけ、通信の失敗なら bootstrapFailed も立てる |  |
| TC-UT_AWEB-015 | SessionProvider（bootstrapSession） | 正常系 | 同値分割 | 起動時のセッションの取得が 200 なら ready にし、表示名と CSRF トークンを置く | なし | GET /admin/api/session → 200 | status ready、表示名 Kaine Yamashiro、getCsrfToken は csrf-token-1 | B16-T, B20-F | fetch を mockFetch で差し替え、MemoryRouter | 一部 TC-NOUS50_DEV-10（画面が出ることだけ） |  | TC-UT_AWEB-015 起動時のセッションの取得が 200 なら ready にし、表示名と CSRF トークンを置く |  |
| TC-UT_AWEB-016 | SessionProvider（signIn / signOut） | 正常系 | 状態遷移 | signIn はログインの応答の CSRF トークンを置いて ready にし、signOut はトークンとクエリのキャッシュを捨てて /login へ移る | セッション 401、login 200（csrf-after-login）、logout 204。キャッシュに ['admin','world'] | signIn → signOut | signIn 後のトークン csrf-after-login・ready、signOut 後に /login・トークン null・キャッシュなし | B19-F | fetch を mockFetch で差し替え、MemoryRouter と Routes | 一部 TC-NOUS50_DEV-15（/login へ移ることだけ） |  | TC-UT_AWEB-016 signIn はログインの応答の CSRF トークンを置いて ready にし、signOut はトークンとクエリのキャッシュを捨てて /login へ移る |  |
| TC-UT_AWEB-017 | useSession | 異常系 | エラー処理 | useSession を SessionProvider の外で使うと例外にする | なし | renderHook(useSession) | Error「useSession は SessionProvider の中で使ってください」 | B20-T | console.error を抑える | なし |  | TC-UT_AWEB-017 useSession を SessionProvider の外で使うと例外にする |  |
| TC-UT_AWEB-018 | RequireSession | 正常系 | 分岐網羅 | セッションの確認中は「読み込み中…」を出し、子の画面を出さない | GET /admin/api/session が返らない | RequireSession の子に PROTECTED | 「読み込み中…」、PROTECTED は出ない | B21-T | fetch を返らない Promise に差し替え | なし |  | TC-UT_AWEB-018 セッションの確認中は「読み込み中…」を出し、子の画面を出さない |  |
| TC-UT_AWEB-019 | loginPathFor | 正常系 | 分岐網羅 | loginPathFor は / なら next を付けず、それ以外はパスと検索文字列を next に入れる | なし | ("/", "")、("/settings", "?tab=1") | /login、/login?next=%2Fsettings%3Ftab%3D1 | B23-T, B23-F | なし | 一部 TC-NOUS50_DEV-12（検索文字列なし） |  | TC-UT_AWEB-019 loginPathFor は / なら next を付けず、それ以外はパスと検索文字列を next に入れる |  |
| TC-UT_AWEB-020 | router / RequireSession | 異常系 | 同値分割 | 未ログインで検索文字列つきの画面を開くと、検索文字列も含めて next に入れて /login へ移る | セッション 401 | /generations?status=failed | /login?next=%2Fgenerations%3Fstatus%3Dfailed、P201 を表示 | B22-T, B23-F | fetch を mockFetch で差し替え、renderApp（createMemoryRouter と QueryClient） | 一部 TC-NOUS50_DEV-12（検索文字列なし） |  | TC-UT_AWEB-020 未ログインで検索文字列つきの画面を開くと、検索文字列も含めて next に入れて /login へ移る |  |

## 3. 確認事項・バグの疑い

- 確認事項 1：main.tsx（createRoot と QueryClient の既定の設定）はエントリーポイントで、document の #root に描画するだけのため単体テストの対象にしない。同じ構成は test/renderApp.tsx で組み、router の DEV・UT で通している。App.tsx は雛形（NOUS-42）で、TC-NOUS42_DEV-04 だけを載せた
- 確認事項 2：useApiErrorHandler の 401 は、OK のあと /login に移るが ?expired=1 を付けない。P201 の L11「ログインの有効期限が切れました」（?expired=1 で来たとき）は、この経路では出ない。様式①で同じ文言を出しているため不足はないと読むが、L11 をどこから使う想定かの確認
