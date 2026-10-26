# 単体テスト観点表：観察画面の API の呼び出しと共通の関数（api/client・endpoints、lib/worldTime・scrollRestore）

| 項目 | 内容 |
|---|---|
| 関連チケット | NOUS-106 |
| 作成者 | Takaya Ishikawa（開発担当） |
| 作成日 | 2026-10-26 |
| 対象 | apps/observer/src/api/client.ts, apps/observer/src/api/endpoints.ts, apps/observer/src/lib/worldTime.ts, apps/observer/src/lib/scrollRestore.ts |
| 言語 / フレームワーク | TypeScript / Vitest 2.1.9（environment: jsdom、Testing Library） |
| テストファイル | apps/observer/src/api/client.test.ts, apps/observer/src/api/client.ut.test.ts, apps/observer/src/api/endpoints.test.ts, apps/observer/src/api/endpoints.ut.test.ts, apps/observer/src/lib/worldTime.test.ts, apps/observer/src/lib/worldTime.ut.test.ts, apps/observer/src/lib/scrollRestore.test.ts, apps/observer/src/lib/scrollRestore.ut.test.ts |
| 外部依存 | fetch, window.location.replace（navigation.toNotInvited で差し替え）, sessionStorage, window.scrollTo, Intl.DateTimeFormat（Asia/Tokyo）, 共通の準備は apps/observer/src/test/observerUt.tsx（このチケットで新しく作った、単体テストだけが使う補助） |
| 入力にした設計書 | FE 詳細設計 observer 3章（永続化ステート）・4章 fetchJson・navigateToNotInvited・get*・formatWorldTime・saveTimelineScroll・restoreTimelineScroll・6章, 画面 P101 H05・H11、P106 E02 |

このファイルは `docs/test/unit/_build/build_matrix.py` で JSON から作る。直すときは JSON を直して作り直す。

## 1. 分岐の一覧

| ID | 条件 | 場所 |
|---|---|---|
| B1 | fetchJson：fetch が例外（NetworkError） | client.ts:45-49 |
| B2 | fetchJson：status が 401 | client.ts:50 |
| B3 | fetchJson：2xx 以外（!res.ok） | client.ts:54 |
| B4 | isApiErrorBody：オブジェクトで error を持つ | client.ts:40・56 |
| B5 | fetchJson：失敗の本文が JSON でない（null にする） | client.ts:55 |
| B6 | withQuery：値が undefined でない | endpoints.ts:22 |
| B7 | withQuery：クエリ文字列が空でない | endpoints.ts:25 |
| B8 | formatWorldTime：負の値を 0 にする（Math.max） | worldTime.ts:7 |
| B9 | saveTimelineScroll：setItem が例外 | scrollRestore.ts:5-9 |
| B10 | restoreTimelineScroll：保存が無い（null） | scrollRestore.ts:15 |
| B11 | restoreTimelineScroll：保存した値が有限の数 | scrollRestore.ts:18 |
| B12 | restoreTimelineScroll：sessionStorage の例外 | scrollRestore.ts:19-21 |

## 2. ケースの一覧（33 件。うち新しく足したもの 19 件）

| ID | 対象 | 分類 | 技法 | 観点 | 前提 | 入力 | 期待結果 | 分岐 | モック | 既存テストとの対応 | バグの疑い | テスト名 | 備考 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| TC-NOUS49_DEV-01 | fetchJson | 正常系 | 開発者テスト | 2xx なら JSON を返し、credentials を same-origin にする | なし | 200 の応答 | 本文の JSON | B1-F, B2-F, B3-F | fetch を vi.stubGlobal で差し替え | 実装時のテスト（NOUS-49） |  | TC-NOUS49_DEV-01 2xx なら JSON を返し、Cookie を同じオリジンで送る |  |
| TC-NOUS49_DEV-02 | fetchJson | 異常系 | 開発者テスト | 401 なら /not-invited へ移して NotInvitedError | なし | 401 | NotInvitedError、toNotInvited を呼ぶ | B2-T | fetch を vi.stubGlobal で差し替え、navigation.toNotInvited | 実装時のテスト（NOUS-49） |  | TC-NOUS49_DEV-02 401 なら /not-invited へ移して NotInvitedError を投げる |  |
| TC-NOUS49_DEV-03 | fetchJson | 異常系 | 開発者テスト | 2xx 以外は本文の error を ApiError にする | なし | 500 と error の本文 | ApiError（status・code） | B3-T, B4-T | fetch を vi.stubGlobal で差し替え | 実装時のテスト（NOUS-49） |  | TC-NOUS49_DEV-03 2xx 以外は本文の error を ApiError にする |  |
| TC-NOUS49_DEV-04 | fetchJson | 異常系 | 開発者テスト | 本文が JSON でない失敗は code を null | なし | 500 と文字の本文 | ApiError（code null） | B4-F, B5-T | fetch を vi.stubGlobal で差し替え | 実装時のテスト（NOUS-49） |  | TC-NOUS49_DEV-04 本文が JSON でない失敗は code を null にする |  |
| TC-NOUS49_DEV-05 | fetchJson | 異常系 | 開発者テスト | 通信できなければ NetworkError | なし | fetch が reject | NetworkError | B1-T | fetch を vi.stubGlobal で差し替え | 実装時のテスト（NOUS-49） |  | TC-NOUS49_DEV-05 通信できなければ NetworkError を投げる |  |
| TC-NOUS49_DEV-06 | withQuery | 正常系 | 開発者テスト | undefined の項目を付けない | なし | 一部が undefined | 定義された項目だけ | B6-T, B6-F, B7-T | なし | 実装時のテスト（NOUS-49） |  | TC-NOUS49_DEV-06 withQuery は undefined の項目を付けない |  |
| TC-NOUS49_DEV-07 | getTimeline | 正常系 | 開発者テスト | limit と since を付けて呼ぶ | なし | { limit, since } | クエリ付きの URL | B6-T | fetch を vi.stubGlobal で差し替え | 実装時のテスト（NOUS-49） |  | TC-NOUS49_DEV-07 getTimeline は limit と since を付けて呼ぶ |  |
| TC-NOUS49_DEV-08 | getThread / getFollows | 正常系 | 開発者テスト | ID をパスに、条件をクエリに | なし | postId・agentId・type | パスとクエリ | B6-T | fetch を vi.stubGlobal で差し替え | 実装時のテスト（NOUS-49） |  | TC-NOUS49_DEV-08 getThread・getFollows は ID をパスに埋め、条件をクエリにする | 実施の手がかり（同じ Response の使い回し） |
| TC-NOUS49_DEV-09 | formatWorldTime | 正常系 | 開発者テスト | 0 秒は第 1 日 00:00 | なし | 0 | 第 1 日 00:00 | B8-F | なし | 実装時のテスト（NOUS-49） |  | TC-NOUS49_DEV-09 経過 0 秒は 第 1 日 00:00 |  |
| TC-NOUS49_DEV-10 | formatWorldTime | 正常系 | 開発者テスト | 86399 秒は第 1 日 23:59 | なし | 86399 | 第 1 日 23:59 | B8-F | なし | 実装時のテスト（NOUS-49） |  | TC-NOUS49_DEV-10 経過 86399 秒は 第 1 日 23:59 |  |
| TC-NOUS49_DEV-11 | formatWorldTime | 正常系 | 開発者テスト | 90061 秒は第 2 日 01:01 | なし | 90061 | 第 2 日 01:01 | B8-F | なし | 実装時のテスト（NOUS-49） |  | TC-NOUS49_DEV-11 経過 90061 秒は 第 2 日 01:01 |  |
| TC-NOUS49_DEV-12 | formatClockJst | 正常系 | 開発者テスト | UTC を JST の HH:MM に | なし | 05:21Z | 14:21 |  | なし | 実装時のテスト（NOUS-49） |  | TC-NOUS49_DEV-12 UTC の時刻を JST の HH:MM にする |  |
| TC-NOUS49_DEV-13 | saveTimelineScroll / restoreTimelineScroll | 正常系 | 開発者テスト | 保存した位置に戻してキーを消す | scrollY=420 | 保存→復元 | scrollTo(0, 420)、キーなし | B9-F, B10-F, B11-T, B12-F | window.scrollTo | 実装時のテスト（NOUS-49） |  | TC-NOUS49_DEV-13 保存した位置に戻し、キーを消す |  |
| TC-NOUS49_DEV-14 | restoreTimelineScroll | 正常系 | 開発者テスト | 保存が無ければ何もしない | 保存なし | 復元 | scrollTo を呼ばない | B10-T | window.scrollTo | 実装時のテスト（NOUS-49） |  | TC-NOUS49_DEV-14 保存が無ければ何もしない |  |
| TC-UT_OWEB-001 | fetchJson | 正常系 | 同値分割 | init（method・headers）を引き継ぎ、credentials は same-origin で上書きする | なし | init={ method: GET, headers, credentials: include } | fetch に { method, headers, credentials: same-origin } | B1-F, B2-F, B3-F | fetch を vi.stubGlobal で差し替え | 一部 TC-NOUS49_DEV-01（init なし） |  | TC-UT_OWEB-001 fetchJson は init を引き継ぎ、credentials は same-origin で上書きする | 設計書 4章：credentials は same-origin |
| TC-UT_OWEB-002 | fetchJson | 異常系 | 分岐網羅 | 401 のときは本文を読まずに /not-invited へ移す | なし | 401 と error の本文 | NotInvitedError、toNotInvited 1 回、res.json は呼ばない | B2-T | fetch を vi.stubGlobal で差し替え、navigation.toNotInvited、res.json の spy | 一部 TC-NOUS49_DEV-02（本文を読まないことは見ていない） |  | TC-UT_OWEB-002 401 のときは本文を読まずに /not-invited へ移す |  |
| TC-UT_OWEB-003 | fetchJson | 異常系 | 同値分割 | 2xx 以外で本文に error があれば status と code の ApiError にし、/not-invited へは移さない（404・403・400） | なし | 404 POST_NOT_FOUND・403・400 | ApiError（status・code・message）、toNotInvited を呼ばない | B2-F, B3-T, B4-T | fetch を vi.stubGlobal で差し替え、navigation.toNotInvited | 一部 TC-NOUS49_DEV-03（500 だけ） |  | TC-UT_OWEB-003 2xx 以外で本文に error があれば、status と code の ApiError にし、/not-invited へは移さない |  |
| TC-UT_OWEB-004 | fetchJson | 異常系 | 同値分割 | 2xx 以外で本文が error の形でなければ code は null、message は「HTTP 状態」 | なし | {"message":"x"}・null・"oops"（500） | ApiError（500、code null、HTTP 500） | B4-F, B5-F | fetch を vi.stubGlobal で差し替え | 一部 TC-NOUS49_DEV-04（JSON でない本文だけ） |  | TC-UT_OWEB-004 2xx 以外で本文が error の形でなければ code は null、message は HTTP の状態にする |  |
| TC-UT_OWEB-005 | fetchJson | 異常系 | エラー処理 | 2xx でも本文が JSON でなければ JSON の例外のまま投げる | なし | 200 と not json | SyntaxError（ApiError・NetworkError にしない） | B3-F | fetch を vi.stubGlobal で差し替え | なし |  | TC-UT_OWEB-005 2xx でも本文が JSON でなければ、ApiError・NetworkError にせず JSON の例外のまま投げる | 設計書に記載なし。実装の値 |
| TC-UT_OWEB-006 | fetchJson | 異常系 | エラー処理 | NetworkError は元の例外を cause に持つ | なし | fetch が TypeError で reject | NetworkError、cause は元の TypeError | B1-T | fetch を vi.stubGlobal で差し替え | 一部 TC-NOUS49_DEV-05（型だけ） |  | TC-UT_OWEB-006 NetworkError は元の例外を cause に持つ |  |
| TC-UT_OWEB-007 | withQuery | 正常系 | 境界値 | 項目がすべて undefined なら ? を付けない | なし | { cursor: undefined, limit: undefined } | /api/timeline | B6-F, B7-F | なし | なし |  | TC-UT_OWEB-007 withQuery は項目がすべて undefined なら ? を付けない |  |
| TC-UT_OWEB-008 | withQuery | 正常系 | 境界値 | 0 と空文字は値として残す | なし | { limit: 0, cursor: '' } | /api/timeline?limit=0&cursor= | B6-T, B7-T | なし | なし |  | TC-UT_OWEB-008 withQuery は 0 と空文字は値として残す |  |
| TC-UT_OWEB-009 | getWorld | 正常系 | 同値分割 | /api/world を呼ぶ | なし | なし | /api/world |  | fetch を vi.stubGlobal で差し替え | なし |  | TC-UT_OWEB-009 getWorld は /api/world を呼ぶ |  |
| TC-UT_OWEB-010 | getTimeline | 正常系 | 同値分割 | 条件なしなら /api/timeline、cursor と limit があればクエリに付ける | なし | {}・{ cursor: c1, limit: 30 } | /api/timeline・/api/timeline?cursor=c1&limit=30 | B7-F, B7-T | fetch を vi.stubGlobal で差し替え | 一部 TC-NOUS49_DEV-07（since だけ） |  | TC-UT_OWEB-010 getTimeline は条件なしなら /api/timeline、cursor と limit があればクエリに付ける |  |
| TC-UT_OWEB-011 | getThread | 正常系 | 同値分割 | postId の / と空白をエンコードし、depth と from を付ける | なし | 'a/b c'、{ depth: 5, from: 01X } | /api/posts/a%2Fb%20c/thread?depth=5&from=01X | B6-T | fetch を vi.stubGlobal で差し替え | 一部 TC-NOUS49_DEV-08（エンコードの要る字なし） |  | TC-UT_OWEB-011 getThread は postId の / と空白をエンコードし、depth と from を付ける |  |
| TC-UT_OWEB-012 | getAgentProfile / getAgentPosts | 正常系 | 同値分割 | agentId をエンコードし、過去投稿には cursor と limit を付ける | なし | 'a/b'、{ cursor: c2, limit: 30 } | /api/agents/a%2Fb・/api/agents/a%2Fb/posts?cursor=c2&limit=30 | B6-T | fetch を vi.stubGlobal で差し替え | なし |  | TC-UT_OWEB-012 getAgentProfile と getAgentPosts は agentId をエンコードし、過去投稿には cursor と limit を付ける |  |
| TC-UT_OWEB-013 | formatWorldTime | 異常系 | 同値分割 | 負の値は 0 に、小数は切り捨てて扱う | なし | -1・59.9 | 第 1 日 00:00 | B8-T | なし | なし |  | TC-UT_OWEB-013 formatWorldTime は負の値を 0 に、小数を切り捨てて扱う | 設計書に負の値の記載なし。世界内時間は 0 以上なので 0 として扱うのを期待とした |
| TC-UT_OWEB-014 | formatWorldTime | 正常系 | 境界値 | 分・時・日の境目で繰り上がる | なし | 59・60・3599・3600・86400 | 00:00・00:01・00:59・01:00・第 2 日 00:00 | B8-F | なし | 一部 TC-NOUS49_DEV-09〜11 |  | TC-UT_OWEB-014 formatWorldTime は分・時・日の境目で繰り上がる |  |
| TC-UT_OWEB-015 | formatClockJst | 正常系 | 境界値 | JST の日付の境目で 23:59 と 00:00 を出す | なし | 14:59Z・15:00Z | 23:59・00:00（24:00 にしない） |  | なし | 一部 TC-NOUS49_DEV-12（日中の時刻だけ） |  | TC-UT_OWEB-015 formatClockJst は JST の日付の境目で 23:59 と 00:00 を出す |  |
| TC-UT_OWEB-016 | saveTimelineScroll | 異常系 | エラー処理 | sessionStorage に保存できなくても例外を出さない | setItem が例外 | 保存 | 例外なし | B9-T | Storage.prototype.setItem | なし |  | TC-UT_OWEB-016 sessionStorage に保存できなくても saveTimelineScroll は例外を出さない | 設計書 4章：使えなければ何もしない |
| TC-UT_OWEB-017 | restoreTimelineScroll | 異常系 | 同値分割 | 保存した値が数でなければスクロールせず、キーは消す | 保存 'abc' | 復元 | scrollTo を呼ばない、キーなし | B10-F, B11-F | window.scrollTo | なし |  | TC-UT_OWEB-017 保存した値が数でなければスクロールせず、キーは消す |  |
| TC-UT_OWEB-018 | restoreTimelineScroll | 異常系 | エラー処理 | sessionStorage を読めなくても例外を出さず、スクロールしない | getItem が例外 | 復元 | 例外なし、scrollTo を呼ばない | B12-T | Storage.prototype.getItem、window.scrollTo | なし |  | TC-UT_OWEB-018 sessionStorage を読めなくても restoreTimelineScroll は例外を出さず、スクロールしない |  |
| TC-UT_OWEB-019 | restoreTimelineScroll | 正常系 | 境界値 | 保存した位置が 0 なら (0, 0) へスクロールする | 保存 '0' | 復元 | scrollTo(0, 0) | B11-T | window.scrollTo | 一部 TC-NOUS49_DEV-13（420 だけ） |  | TC-UT_OWEB-019 保存した位置が 0 なら先頭（0, 0）へスクロールする |  |

## 3. 確認事項・バグの疑い

- 確認事項 1：navigateToNotInvited（window.location.replace）は jsdom の location を差し替えられないため単体テストでは直接通さない。fetchJson からの呼び出しは navigation.toNotInvited を差し替えて確かめている（TC-NOUS49_DEV-02、TC-UT_OWEB-002）。履歴に残らないことは結合テスト（Playwright）で見る
- 実施の手がかり：TC-NOUS49_DEV-08 は fetch の mockResolvedValue で同じ Response を 2 回返すため、2 回目の res.json() が「Body has already been read」で落ちる見込み。テストの書き方の問題として切り分ける（UT では呼ぶたびに新しい Response を作っている）
