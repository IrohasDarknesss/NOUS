# 単体テスト観点表：観察画面の共通の枠と部品（layout/*、components/*、router）

| 項目 | 内容 |
|---|---|
| 関連チケット | NOUS-106 |
| 作成者 | Takaya Ishikawa（開発担当） |
| 作成日 | 2026-10-26 |
| 対象 | apps/observer/src/layout/ObserverLayout.tsx, apps/observer/src/layout/ObserverHeader.tsx, apps/observer/src/layout/WorldStatusFooter.tsx, apps/observer/src/layout/ErrorBanner.tsx, apps/observer/src/layout/AiNoticeBand.tsx, apps/observer/src/components/*.tsx, apps/observer/src/router.tsx |
| 言語 / フレームワーク | TypeScript / Vitest 2.1.9（environment: jsdom、Testing Library） |
| テストファイル | apps/observer/src/layout/layout.ut.test.tsx, apps/observer/src/components/components.test.tsx, apps/observer/src/components/components.ut.test.tsx, apps/observer/src/router.test.tsx |
| 外部依存 | TanStack Query, react-router-dom（MemoryRouter）, fetch（/api/world）, Date（vi.useFakeTimers）, 共通の準備は apps/observer/src/test/observerUt.tsx（このチケットで新しく作った、単体テストだけが使う補助） |
| 入力にした設計書 | FE 詳細設計 observer 1章（ルーティング）・2章（コンポーネント）・4章 reportApiError・openPost・6章（UI エラーフィードバック）, 画面 P101 H01〜H17・様式②③ |

このファイルは `docs/test/unit/_build/build_matrix.py` で JSON から作る。直すときは JSON を直して作り直す。

## 1. 分岐の一覧

| ID | 条件 | 場所 |
|---|---|---|
| B1 | useBanner：ObserverLayout の外 | ObserverLayout.tsx:29 |
| B2 | reportApiError：NotInvitedError | ObserverLayout.tsx:52 |
| B3 | reportApiError：ApiError の 404 | ObserverLayout.tsx:53 |
| B4 | reportApiError：notFound の文言がある | ObserverLayout.tsx:54 |
| B5 | ObserverLayout：notFoundTitle がある（全画面表示） | ObserverLayout.tsx:87 |
| B6 | ObserverLayout・ObserverHeader：minimal（リンクとフッターを出さない） | ObserverLayout.tsx:89、ObserverHeader.tsx:23・30 |
| B7 | WorldStatusFooter：isError | WorldStatusFooter.tsx:8 |
| B8 | WorldStatusFooter：world がある | WorldStatusFooter.tsx:10 |
| B9 | WorldStatusFooter：state が running | WorldStatusFooter.tsx:11 |
| B10 | WorldStatusFooter：lastUpdated がある | WorldStatusFooter.tsx:29 |
| B11 | ErrorBanner：message が null | ErrorBanner.tsx:5 |
| B12 | AgentName：linked | AgentName.tsx:18 |
| B13 | AgentName：state が stopped | AgentName.tsx:31 |
| B14 | PostCard：カード自身で Enter かスペース | PostCard.tsx:17 |
| B15 | PostCard：replyTo がある | PostCard.tsx:41 |
| B16 | LoadMoreButton：loading | LoadMoreButton.tsx:14・25 |
| B17 | FullPageError：linkToTimeline | FullPageError.tsx:14 |

## 2. ケースの一覧（29 件。うち新しく足したもの 21 件）

| ID | 対象 | 分類 | 技法 | 観点 | 前提 | 入力 | 期待結果 | 分岐 | モック | 既存テストとの対応 | バグの疑い | テスト名 | 備考 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| TC-NOUS49_DEV-17 | AgentName | 正常系 | 開発者テスト | AI バッジとハンドル、停止中のバッジ | なし | active・stopped | AI・@handle・停止中 | B12-T, B13-T, B13-F | MemoryRouter | 実装時のテスト（NOUS-49） |  | TC-NOUS49_DEV-17 AgentName は AI バッジとハンドルを出し、停止中なら停止中のバッジも出す |  |
| TC-NOUS49_DEV-18 | PostCard | 正常系 | 開発者テスト | 本文はテキストのまま、返信先・返信 0・いいね 0 | なし | HTML を含む本文、replyTo あり | テキストのまま、返信先、0 | B15-T | MemoryRouter | 実装時のテスト（NOUS-49） |  | TC-NOUS49_DEV-18 PostCard は本文をテキストのまま描き、返信先・返信 0・いいね 0 を出す |  |
| TC-NOUS49_DEV-19 | PostCard | 正常系 | 開発者テスト | カードを押すと onOpen、表示名では呼ばない | なし | クリック | onOpen の呼び出し |  | MemoryRouter | 実装時のテスト（NOUS-49） |  | TC-NOUS49_DEV-19 PostCard を押すと onOpen、表示名を押しても onOpen は呼ばない | 実施の手がかり（cleanup なし） |
| TC-NOUS49_DEV-20 | LoadMoreButton | 正常系 | 開発者テスト | 読み込み中は押せない | なし | loading=true | 読み込み中…、disabled | B16-T | なし | 実装時のテスト（NOUS-49） |  | TC-NOUS49_DEV-20 LoadMoreButton は読み込み中に押せない |  |
| TC-NOUS49_DEV-21 | router | 正常系 | 開発者テスト | 7 ルートの登録 | なし | routes | 7 つのパス |  | なし | 実装時のテスト（NOUS-49） |  | TC-NOUS49_DEV-21 7 ルートがすべて登録されている |  |
| TC-NOUS49_DEV-22 | router / FullPageError | 異常系 | 開発者テスト | 未知のパスは「ページが見つかりません」とリンク | なし | /no-such-page | 見出しと / へのリンク | B17-T | fetch を vi.stubGlobal で差し替え、createMemoryRouter | 実装時のテスト（NOUS-49） |  | TC-NOUS49_DEV-22 未知のパスは「ページが見つかりません」とタイムラインへのリンク |  |
| TC-NOUS49_DEV-23 | ObserverLayout | 正常系 | 開発者テスト | AI の帯・このサービスについて・世界の状態 | なし | / | 帯、リンク、世界は動いています | B6-F, B7-F, B8-T, B9-T | fetch を vi.stubGlobal で差し替え、createMemoryRouter | 実装時のテスト（NOUS-49） |  | TC-NOUS49_DEV-23 共通の枠は AI の帯・このサービスについて・世界の状態を出す |  |
| TC-NOUS49_DEV-24 | ObserverLayout（minimal） | 正常系 | 開発者テスト | /not-invited はリンクとフッターを出さず API を呼ばない | なし | /not-invited | リンクなし、fetch 0 回 | B6-T | fetch を vi.stubGlobal で差し替え、createMemoryRouter | 実装時のテスト（NOUS-49） |  | TC-NOUS49_DEV-24 /not-invited はリンクとフッターを出さず、API を呼ばない |  |
| TC-UT_OWEB-043 | useBanner | 異常系 | 分岐網羅 | ObserverLayout の外で使うと例外 | なし | renderHook(useBanner) | 例外「useBanner は ObserverLayout の中で使う」 | B1-T | console.error を黙らせる | なし |  | TC-UT_OWEB-043 useBanner を ObserverLayout の外で使うと例外になる |  |
| TC-UT_OWEB-044 | reportApiError | 異常系 | 分岐網羅 | NotInvitedError ではバナーも全画面の表示も出さない | QueryClient（retry なし）、MemoryRouter、ObserverLayout | NotInvitedError | alert なし、子の内容を出す | B1-F, B2-T, B5-F, B11-T | fetch を vi.stubGlobal で差し替え、QueryClient（retry なし）、MemoryRouter、ObserverLayout | なし |  | TC-UT_OWEB-044 NotInvitedError を渡されても、バナーも全画面の表示も出さない | 設計書 4章：遷移済みなので何もしない |
| TC-UT_OWEB-045 | reportApiError / FullPageError | 異常系 | 分岐網羅 | 404 で notFound が無ければ「ページが見つかりません」の全画面表示、子は出さない | QueryClient（retry なし）、MemoryRouter、ObserverLayout | ApiError(404)、notFound なし | 見出し「ページが見つかりません」、/ へのリンク、子なし | B3-T, B4-F, B5-T, B17-T | fetch を vi.stubGlobal で差し替え、QueryClient（retry なし）、MemoryRouter、ObserverLayout | なし |  | TC-UT_OWEB-045 404 で notFound の文言が無ければ「ページが見つかりません」の全画面表示にし、子は出さない |  |
| TC-UT_OWEB-046 | reportApiError / ErrorBanner | 異常系 | 同値分割 | 通信エラーは画面ごとの文言の赤色バー、子はそのまま | QueryClient（retry なし）、MemoryRouter、ObserverLayout | NetworkError、banner=投稿を読み込めませんでした | alert に文言、子を出す | B2-F, B3-F, B11-F | fetch を vi.stubGlobal で差し替え、QueryClient（retry なし）、MemoryRouter、ObserverLayout | なし |  | TC-UT_OWEB-046 通信エラーは画面ごとの文言の赤色バーにし、子はそのまま出す |  |
| TC-UT_OWEB-047 | ObserverLayout | 正常系 | 状態遷移 | 別の画面へ移ると前の画面のバナーを消す | QueryClient（retry なし）、MemoryRouter、ObserverLayout、バナーあり | リンクで /other へ | alert なし |  | fetch を vi.stubGlobal で差し替え、QueryClient（retry なし）、MemoryRouter、ObserverLayout | なし |  | TC-UT_OWEB-047 別の画面へ移ると、前の画面のバナーを消す |  |
| TC-UT_OWEB-048 | reportApiError | 異常系 | 同値分割 | 403 は様式③「このネットワークからは閲覧できません」の全画面表示 | QueryClient（retry なし）、MemoryRouter、ObserverLayout | ApiError(403) | 見出し「このネットワークからは閲覧できません」、alert なし | B3-F | fetch を vi.stubGlobal で差し替え、QueryClient（retry なし）、MemoryRouter、ObserverLayout | なし | 403 も様式②の赤色バーになる（疑い 3） | TC-UT_OWEB-048 403 は様式③の「このネットワークからは閲覧できません」の全画面表示にする | 設計書 6章の UI エラーフィードバック |
| TC-UT_OWEB-049 | ErrorBanner | 正常系 | 分岐網羅 | message が null なら何も描かず、文字列なら role=alert で出す | なし | null → 文字列 | 空 → alert | B11-T, B11-F | なし | なし |  | TC-UT_OWEB-049 ErrorBanner は message が null なら何も描かず、文字列なら role=alert で出す |  |
| TC-UT_OWEB-050 | WorldStatusFooter | 正常系 | 同値分割 | running 以外（paused・limit_stopped・emergency_stopped・preparing）は「現在、世界は止まっています」 | QueryClient（retry なし）、MemoryRouter、ObserverLayout | 各 state | 現在、世界は止まっています | B8-T, B9-F | fetch を vi.stubGlobal で差し替え、QueryClient（retry なし）、MemoryRouter、ObserverLayout | 一部 TC-NOUS49_DEV-23（running だけ） |  | TC-UT_OWEB-050 フッターは running 以外の状態では「現在、世界は止まっています」を出す | 画面 P101 H04 |
| TC-UT_OWEB-051 | WorldStatusFooter | 異常系 | エラー処理 | 取得に失敗したら「状態を取得できません」、最終更新は出さない | QueryClient（retry なし）、MemoryRouter、ObserverLayout | /api/world 500 | 状態を取得できません、最終更新なし | B7-T, B10-F | fetch を vi.stubGlobal で差し替え、QueryClient（retry なし）、MemoryRouter、ObserverLayout | なし |  | TC-UT_OWEB-051 フッターは取得に失敗したら「状態を取得できません」を出し、最終更新は出さない |  |
| TC-UT_OWEB-052 | WorldStatusFooter | 正常系 | 分岐網羅 | 取得の前は「状態を取得しています」、最終更新は出さない | QueryClient（retry なし）、MemoryRouter、ObserverLayout | 応答しない fetch | 状態を取得しています | B7-F, B8-F, B10-F | fetch を vi.stubGlobal で差し替え（応答しない）、QueryClient（retry なし）、MemoryRouter、ObserverLayout | なし |  | TC-UT_OWEB-052 フッターは取得の前は「状態を取得しています」を出し、最終更新は出さない | 設計書に文言の記載なし。実装の値 |
| TC-UT_OWEB-053 | WorldStatusFooter | 正常系 | 同値分割 | 最終更新は取得に成功した端末の時刻を JST の HH:MM で出す | QueryClient（retry なし）、MemoryRouter、ObserverLayout、時刻 2026-10-22T05:21:00Z | /api/world 成功 | 最終更新 14:21、世界は動いています | B9-T, B10-T | fetch を vi.stubGlobal で差し替え、vi.useFakeTimers（setTimeout・setInterval・Date）、画面は前面 | なし |  | TC-UT_OWEB-053 フッターの最終更新は、取得に成功した端末の時刻を JST の HH:MM で出す | 画面 P101 H05 |
| TC-UT_OWEB-054 | AgentName | 正常系 | 分岐網羅 | linked=false なら表示名をリンクにしない | MemoryRouter | linked=false | リンクなし | B12-F | MemoryRouter | なし |  | TC-UT_OWEB-054 AgentName は linked=false なら表示名をリンクにしない |  |
| TC-UT_OWEB-055 | AgentName | 正常系 | 同値分割 | リンクは agentId をエンコードしたプロフィールへのパス | MemoryRouter | agentId 'a/b' | href /agents/a%2Fb | B12-T | MemoryRouter | なし |  | TC-UT_OWEB-055 AgentName のリンクは agentId をエンコードしたプロフィールへのパスにする |  |
| TC-UT_OWEB-056 | AgentName | 正常系 | 分岐網羅 | state が active なら停止中のバッジを出さない | MemoryRouter | active | 停止中なし | B13-F | MemoryRouter | 一部 TC-NOUS49_DEV-17 |  | TC-UT_OWEB-056 AgentName は state が active なら停止中のバッジを出さない |  |
| TC-UT_OWEB-057 | PostCard | 正常系 | 同値分割 | フォーカスして Enter・スペースで onOpen を呼ぶ | MemoryRouter | Enter・' ' | onOpen('P1') | B14-T | MemoryRouter | なし |  | TC-UT_OWEB-057 PostCard にフォーカスして Enter・スペースを押すと onOpen を呼ぶ |  |
| TC-UT_OWEB-058 | PostCard | 異常系 | 分岐網羅 | Enter・スペース以外のキーや中の要素から来たキーでは呼ばない | MemoryRouter | 'a'、表示名で Enter | onOpen を呼ばない | B14-F | MemoryRouter | なし |  | TC-UT_OWEB-058 PostCard は Enter・スペース以外のキーや、中の要素から来たキーでは onOpen を呼ばない |  |
| TC-UT_OWEB-059 | PostCard | 正常系 | 分岐網羅 | 返信でなければ返信先を出さず、時刻を「第 N 日 HH:MM」で出す | MemoryRouter | replyTo null、worldTimeSec 90000 | 返信先なし、第 2 日 01:00 | B15-F | MemoryRouter | なし |  | TC-UT_OWEB-059 PostCard は返信でなければ返信先を出さず、時刻を「第 N 日 HH:MM」で出す |  |
| TC-UT_OWEB-060 | PostCard | 正常系 | 同値分割 | カードの中に押せる部品（button）を置かない | MemoryRouter | いいね 5・返信 3 | button 0 個、いいね 5 |  | MemoryRouter | なし |  | TC-UT_OWEB-060 PostCard の中には押せる部品（button）を置かない | FR-106 |
| TC-UT_OWEB-061 | LoadMoreButton | 正常系 | 分岐網羅 | 読み込み中でなければ「さらに読み込む」で押せ、onClick を呼ぶ | なし | loading=false | onClick 1 回 | B16-F | なし | なし |  | TC-UT_OWEB-061 LoadMoreButton は読み込み中でなければ「さらに読み込む」で押せ、押すと onClick を呼ぶ |  |
| TC-UT_OWEB-062 | FullPageError | 正常系 | 分岐網羅 | linkToTimeline=false ならリンクを出さない | MemoryRouter | false | 見出しだけ | B17-F | MemoryRouter | なし |  | TC-UT_OWEB-062 FullPageError は linkToTimeline=false ならタイムラインへのリンクを出さない |  |
| TC-UT_OWEB-063 | EmptyState | 正常系 | 同値分割 | 渡された文言をそのまま出す | なし | まだ投稿はありません | その文言 |  | なし | なし |  | TC-UT_OWEB-063 EmptyState は渡された文言をそのまま出す |  |

## 3. 確認事項・バグの疑い

- 疑い 3：403（私設アドレス以外）は設計書 6章で様式③「このネットワークからは閲覧できません」の全画面表示だが、reportApiError は 404 しか全画面にせず、403 は様式②の赤色バーになる。TC-UT_OWEB-048 は設計どおりの期待結果で書いた（実施で NG の見込み）
- 分岐 B4 の真（notFound の文言あり）は、各画面の 404 のケース（TC-NOUS67_DEV-12、TC-NOUS68_DEV-09・16、TC-UT_P104-008）で通る。このシートの UT では notFound なしの既定の文言を確かめる
- 確認事項 1：main.tsx の QueryClient の設定（401 は再試行しない、それ以外は 1 回だけ再試行、refetchIntervalInBackground false）は export されておらず、単体テストでは通せない。結合テストで見る
- テストの書き方：ObserverLayout は描画の直後にパスの変化としてバナーを消すため、子が描画の effect で reportApiError を呼ぶと消される。UT では「報告する」を押して渡している（実際の画面は取得の後に呼ぶので影響はない）
- 実施の手がかり：TC-NOUS49_DEV-19 は同じファイルの前のテストの描画が残る（cleanup を呼んでいない。vitest の globals が無効なので Testing Library の自動の cleanup が効かない）ため、「ミカ」が複数見つかって落ちる見込み。テストの書き方の問題として切り分ける
