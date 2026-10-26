# 単体テスト観点表：観察画面のフック（hooks/useVisibilityPolling・useWorldStatus・useTimeline・useThread・useAgentProfile・useFollows）

| 項目 | 内容 |
|---|---|
| 関連チケット | NOUS-106 |
| 作成者 | Takaya Ishikawa（開発担当） |
| 作成日 | 2026-10-26 |
| 対象 | apps/observer/src/hooks/useVisibilityPolling.ts, apps/observer/src/hooks/useWorldStatus.ts, apps/observer/src/hooks/useTimeline.ts, apps/observer/src/hooks/useThread.ts, apps/observer/src/hooks/useAgentProfile.ts, apps/observer/src/hooks/useFollows.ts |
| 言語 / フレームワーク | TypeScript / Vitest 2.1.9（environment: jsdom、Testing Library） |
| テストファイル | apps/observer/src/hooks/useVisibilityPolling.test.ts, apps/observer/src/hooks/useVisibilityPolling.ut.test.ts, apps/observer/src/hooks/useWorldStatus.ut.test.tsx, apps/observer/src/hooks/useTimeline.test.tsx, apps/observer/src/hooks/useTimeline.ut.test.tsx, apps/observer/src/hooks/useThread.ut.test.tsx, apps/observer/src/hooks/useAgentProfile.test.tsx, apps/observer/src/hooks/useAgentProfile.ut.test.tsx, apps/observer/src/hooks/useFollows.test.tsx, apps/observer/src/hooks/useFollows.ut.test.tsx |
| 外部依存 | TanStack Query（QueryClient、retry なし）, fetch, document.visibilityState と visibilitychange, setTimeout・setInterval（vi.useFakeTimers）, window.scrollTo, 共通の準備は apps/observer/src/test/observerUt.tsx（このチケットで新しく作った、単体テストだけが使う補助） |
| 入力にした設計書 | FE 詳細設計 observer 3章・4章 useWorldStatus・useVisibilityPolling・useTimeline・mergePending・useThread・useAgentProfile・useFollows, 画面 P101 E02・E03、P102 E05 |

このファイルは `docs/test/unit/_build/build_matrix.py` で JSON から作る。直すときは JSON を直して作り直す。

## 1. 分岐の一覧

| ID | 条件 | 場所 |
|---|---|---|
| B1 | isVisible：document が無いか visibilityState が visible | useVisibilityPolling.ts:8 |
| B2 | useVisibilityPolling：前面なら intervalMs、隠れていれば false | useVisibilityPolling.ts:22 |
| B3 | useConsecutiveFailures：dataUpdatedAt が変わり、errorUpdatedAt 以上（0 に戻す） | useVisibilityPolling.ts:34 |
| B4 | useConsecutiveFailures：errorUpdatedAt が変わった（+1） | useVisibilityPolling.ts:36 |
| B5 | useWorldStatus：dataUpdatedAt > 0（lastUpdated を作る） | useWorldStatus.ts:18 |
| B6 | useTimeline：nextCursor がある（getNextPageParam） | useTimeline.ts:17 |
| B7 | useTimeline：ページ・items が無ければ空の配列 | useTimeline.ts:21 |
| B8 | useTimeline：先頭の postId がある（新しい投稿の取得を有効にする） | useTimeline.ts:30 |
| B9 | pendingCount：新しい投稿が 0 件 | useTimeline.ts:36 |
| B10 | pendingCount：一覧に無い postId | useTimeline.ts:40 |
| B11 | mergePending：一覧のデータが無いかページが 0 | useTimeline.ts:52 |
| B12 | mergePending：足す投稿が 0 件 | useTimeline.ts:61 |
| B13 | mergePending：1 ページ目が無い | useTimeline.ts:63 |
| B14 | mergePending：新しい投稿のデータがある（items を空にする） | useTimeline.ts:70 |
| B15 | useThread：postId が変わった（既知の ID を捨てる） | useThread.ts:23 |
| B16 | useThread：postId が空でない（取得を有効にする） | useThread.ts:31 |
| B17 | useThread：データが無い | useThread.ts:36 |
| B18 | useThread：最初のデータ（既知の ID が null） | useThread.ts:38 |
| B19 | useThread：増えた返信がある | useThread.ts:50 |
| B20 | useThread：newIds が空（消すタイマーを張らない） | useThread.ts:56 |
| B21 | useAgentProfile：agentId が空でない（取得を有効にする） | useAgentProfile.ts:29・43 |
| B22 | useAgentProfile：過去投稿のデータがある | useAgentProfile.ts:46 |
| B23 | useAgentProfile：続きの取得の失敗か（postsError と fetchNextPageError の振り分け） | useAgentProfile.ts:55-56 |
| B24 | useFollows：agentId が空でない | useFollows.ts:19 |
| B25 | useFollows：データがある（items） | useFollows.ts:23 |

## 2. ケースの一覧（31 件。うち新しく足したもの 24 件）

| ID | 対象 | 分類 | 技法 | 観点 | 前提 | 入力 | 期待結果 | 分岐 | モック | 既存テストとの対応 | バグの疑い | テスト名 | 備考 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| TC-NOUS49_DEV-15 | useVisibilityPolling | 正常系 | 開発者テスト | 前面なら 30 秒、隠れたら false、戻ったら 30 秒 | 前面 | visibilitychange | 30000 → false → 30000 | B1-T, B1-F, B2-T, B2-F | visibilityState | 実装時のテスト（NOUS-49） |  | TC-NOUS49_DEV-15 前面なら 30 秒、隠れたら false、戻ったら 30 秒 |  |
| TC-NOUS49_DEV-16 | useConsecutiveFailures | 正常系 | 開発者テスト | 失敗のたびに増え、成功で 0 に戻る | なし | errorUpdatedAt・dataUpdatedAt の更新 | 1・2 → 0 | B3-T, B4-T | なし | 実装時のテスト（NOUS-49） |  | TC-NOUS49_DEV-16 失敗のたびに増え、成功で 0 に戻る |  |
| TC-NOUS67_DEV-01 | useTimeline | 正常系 | 開発者テスト | pendingCount は一覧に無い新しい投稿だけを数える | 一覧あり | since の応答 | 件数 | B8-T, B9-F, B10-T, B10-F, B7-F | fetch を vi.stubGlobal で差し替え | 実装時のテスト（NOUS-67） |  | TC-NOUS67_DEV-01 pendingCount が一覧に無い新しい投稿だけを数える |  |
| TC-NOUS67_DEV-02 | useTimeline / mergePending | 正常系 | 開発者テスト | mergePending で先頭に重複なく入り pending が 0 | 一覧と新しい投稿 | mergePending | 先頭に入る、pendingCount 0 | B11-F, B12-F, B13-F, B14-T | fetch を vi.stubGlobal で差し替え | 実装時のテスト（NOUS-67） |  | TC-NOUS67_DEV-02 mergePending で先頭に重複なく入り pending が 0 になる |  |
| TC-NOUS68_DEV-01 | useAgentProfile | 正常系 | 開発者テスト | プロフィールと先頭 30 件を取り、続きを結合する | なし | fetchNextPage | 結合した posts | B21-T, B22-T, B23-F | getAgentProfile・getAgentPosts | 実装時のテスト（NOUS-68） |  | TC-NOUS68_DEV-01 プロフィールと先頭 30 件の過去投稿を取得し、続きを fetchNextPage で結合する |  |
| TC-NOUS68_DEV-02 | useFollows | 正常系 | 開発者テスト | getFollows を type=following で呼ぶ | なし | following | 一覧 | B24-T, B25-T | getFollows | 実装時のテスト（NOUS-68） |  | TC-NOUS68_DEV-02 getFollows を type=following で呼び出して一覧を返す |  |
| TC-NOUS68_DEV-03 | useFollows | 正常系 | 開発者テスト | getFollows を type=followers で呼ぶ | なし | followers | 一覧 | B24-T, B25-T | getFollows | 実装時のテスト（NOUS-68） |  | TC-NOUS68_DEV-03 getFollows を type=followers で呼び出して一覧を返す |  |
| TC-UT_OWEB-020 | useVisibilityPolling | 正常系 | 同値分割 | intervalMs を渡すと、前面のときその値を返す | 前面 | 5000 | 5000 | B2-T | visibilityState | 一部 TC-NOUS49_DEV-15（既定の 30 秒だけ） |  | TC-UT_OWEB-020 intervalMs を渡すと、前面のときその値を返す |  |
| TC-UT_OWEB-021 | useVisibilityPolling | 正常系 | 状態遷移 | 隠れた状態で始まると false、前面に戻ると 30 秒 | 隠れている | visible へ | false → 30000 | B1-F, B2-F, B2-T | visibilityState | 一部 TC-NOUS49_DEV-15（前面から始まる） |  | TC-UT_OWEB-021 隠れた状態で始まると false を返し、前面に戻ると 30 秒にする |  |
| TC-UT_OWEB-022 | useVisibilityPolling | 正常系 | 依存 | unmount で visibilitychange の購読を外す | なし | unmount | removeEventListener('visibilitychange') |  | document.removeEventListener の spy | なし |  | TC-UT_OWEB-022 unmount すると visibilitychange の購読を外す |  |
| TC-UT_OWEB-023 | useConsecutiveFailures | 異常系 | 境界値 | 失敗が 2 回で 2、3 回でしきい値の 3 | なし | errorUpdatedAt を 3 回更新 | 2 → 3（POLLING_FAILURE_THRESHOLD） | B4-T | なし | 一部 TC-NOUS49_DEV-16 |  | TC-UT_OWEB-023 失敗が 2 回続くと 2、3 回続くとしきい値の 3 になる |  |
| TC-UT_OWEB-024 | useConsecutiveFailures | 異常系 | 分岐網羅 | dataUpdatedAt が変わっても errorUpdatedAt より古ければ 0 に戻さない | 失敗 1 回（errorUpdatedAt=500） | dataUpdatedAt=400 | 1 のまま | B3-F, B4-F | なし | なし |  | TC-UT_OWEB-024 dataUpdatedAt が変わっても errorUpdatedAt より古ければ 0 に戻さない |  |
| TC-UT_OWEB-025 | useConsecutiveFailures | 正常系 | 境界値 | 最初の描画では値が 0 でなくても数えない | なし | errorUpdatedAt=900、dataUpdatedAt=100 | 0 | B3-F, B4-F | なし | なし |  | TC-UT_OWEB-025 最初の描画では、値が 0 でなくても数えない |  |
| TC-UT_OWEB-026 | useWorldStatus | 正常系 | 分岐網羅 | 成功の前は world・lastUpdated なし、成功で取得の時刻を lastUpdated に | vi.useFakeTimers（setTimeout・setInterval・Date）、画面は前面、2026-10-22T05:21:00Z | /api/world 成功 | 前：undefined・null・false、後：running・05:21:00Z | B5-F, B5-T | fetch を vi.stubGlobal で差し替え、vi.useFakeTimers（setTimeout・setInterval・Date）、画面は前面 | なし |  | TC-UT_OWEB-026 成功の前は world も lastUpdated も無く、成功すると取得の時刻を lastUpdated にする |  |
| TC-UT_OWEB-027 | useWorldStatus | 異常系 | エラー処理 | 取得に失敗すると isError、lastUpdated は null | なし | /api/world 500 | isError true、lastUpdated null | B5-F | fetch を vi.stubGlobal で差し替え | なし |  | TC-UT_OWEB-027 取得に失敗すると isError を true にし、lastUpdated は null のまま |  |
| TC-UT_OWEB-028 | useWorldStatus | 正常系 | 境界値 | 前面なら 30 秒ごとに取り直し（29,999 では取らない）、隠れている間は取らない | vi.useFakeTimers（setTimeout・setInterval・Date）、画面は前面 | 29,999 → 30,000 → 隠す → 90,000 | 呼び出し 1 → 2 → 2 | B2-T, B2-F | fetch を vi.stubGlobal で差し替え、vi.useFakeTimers（setTimeout・setInterval・Date）、画面は前面 | なし |  | TC-UT_OWEB-028 前面のときは 30 秒ごとに取り直し、隠れている間は取りに行かない | 画面 P101 E02（document.visibilityState が visible のとき） |
| TC-UT_OWEB-029 | useTimeline | 正常系 | 分岐網羅 | 先頭は limit=30、nextCursor があれば cursor 付きで続きを取り、無ければ hasNextPage を false に | なし | 先頭 nextCursor=c1、続き null | /api/timeline?cursor=c1&limit=30、P2・P1、hasNextPage false | B6-T, B6-F | fetch を vi.stubGlobal で差し替え | なし |  | TC-UT_OWEB-029 先頭は limit=30 で取り、nextCursor があれば続きを cursor 付きで取り、無ければ hasNextPage を false にする |  |
| TC-UT_OWEB-030 | useTimeline | 正常系 | 分岐網羅 | 一覧が 0 件のときは新しい投稿の取得（since）をしない | vi.useFakeTimers（setTimeout・setInterval・Date）、画面は前面 | 先頭 0 件、60 秒進める | since の呼び出し 0 回 | B8-F | fetch を vi.stubGlobal で差し替え、vi.useFakeTimers（setTimeout・setInterval・Date）、画面は前面 | なし |  | TC-UT_OWEB-030 一覧が 0 件のときは新しい投稿の取得（since）をしない | 確認事項 1。設計書に記載なし。実装の値（画面の期待は P101 の疑い 2） |
| TC-UT_OWEB-031 | useTimeline | 正常系 | 同値分割 | 新しい投稿は先頭の postId を since に limit=30 で取り、前面のとき 30 秒ごとに取り直す | vi.useFakeTimers（setTimeout・setInterval・Date）、画面は前面 | 先頭 P9・P8、30 秒進める | /api/timeline?limit=30&since=P9、呼び出し 1 → 2 | B8-T | fetch を vi.stubGlobal で差し替え、vi.useFakeTimers（setTimeout・setInterval・Date）、画面は前面 | 一部 TC-NOUS67_DEV-01（30 秒ごとは見ていない） |  | TC-UT_OWEB-031 新しい投稿は先頭の postId を since にして limit=30 で取り、前面のとき 30 秒ごとに取り直す |  |
| TC-UT_OWEB-032 | useTimeline | 正常系 | 同値分割 | 新しい投稿の中で同じ postId が重なっても 1 件と数える | 一覧 P9 | 新しい投稿 P11・P11・P10 | pendingCount 2 | B9-F, B10-T | fetch を vi.stubGlobal で差し替え | なし |  | TC-UT_OWEB-032 pendingCount は新しい投稿の中で同じ postId が重なっても 1 件と数える |  |
| TC-UT_OWEB-033 | mergePending | 正常系 | 分岐網羅 | 新しい投稿が無いとき一覧を変えず、先頭へスクロールする | 一覧 P9、新しい投稿 0 件 | mergePending | pages は同じ参照、scrollTo(0, 0) | B12-T, B14-T, B9-T | fetch を vi.stubGlobal で差し替え、window.scrollTo | なし |  | TC-UT_OWEB-033 新しい投稿が無いとき mergePending は一覧を変えず、先頭へスクロールする |  |
| TC-UT_OWEB-034 | mergePending | 正常系 | 分岐網羅 | 2 ページ目以降を変えず、1 ページ目の先頭にだけ足す | 2 ページ（P9 / P1）、新しい投稿 P10 | mergePending | P10・P9・P1、pendingCount 0 | B11-F, B12-F, B13-F | fetch を vi.stubGlobal で差し替え、window.scrollTo | 一部 TC-NOUS67_DEV-02（1 ページだけ） |  | TC-UT_OWEB-034 mergePending は 2 ページ目以降を変えず、1 ページ目の先頭にだけ足す |  |
| TC-UT_OWEB-064 | mergePending | 異常系 | 分岐網羅 | 一覧も新しい投稿もまだ無いときに呼んでも例外を出さず、先頭へスクロールだけする | 取得中（応答なし） | mergePending | pages []、scrollTo(0, 0) | B11-T, B14-F, B7-T | fetch を vi.stubGlobal で差し替え（応答しない）、window.scrollTo | なし |  | TC-UT_OWEB-064 一覧も新しい投稿もまだ無いときに mergePending を呼んでも、例外を出さずに先頭へスクロールだけする |  |
| TC-UT_OWEB-035 | useThread | 正常系 | 分岐網羅 | スレッドは depth=5 で取り、postId が空なら取らない | vi.useFakeTimers（setTimeout・setInterval・Date）、画面は前面 | postId R と空 | /api/posts/R/thread?depth=5 の 1 回だけ | B16-T, B16-F, B17-T | fetch を vi.stubGlobal で差し替え、vi.useFakeTimers（setTimeout・setInterval・Date）、画面は前面 | なし |  | TC-UT_OWEB-035 スレッドは depth=5 で取り、postId が空なら取りに行かない |  |
| TC-UT_OWEB-036 | useThread | 正常系 | 境界値 | 最初の取得では newIds は空、再取得で増えた返信だけを newIds にし、999 ミリ秒では残り 1,000 ミリ秒で消す | vi.useFakeTimers（setTimeout・setInterval・Date）、画面は前面 | C1 → C1・C2（30 秒後） | 空 → [C2] → [C2]（999）→ 空（1000） | B18-T, B18-F, B19-T, B19-F, B20-T, B20-F, B15-F, B17-F | fetch を vi.stubGlobal で差し替え、vi.useFakeTimers（setTimeout・setInterval・Date）、画面は前面 | なし |  | TC-UT_OWEB-036 最初の取得では newIds は空、再取得で増えた返信だけを newIds にし、999 ミリ秒では残り 1,000 ミリ秒で消す | 画面 P102 E05：1 秒だけ背景を黄色にする |
| TC-UT_OWEB-037 | useThread | 正常系 | 状態遷移 | postId が変わったら、新しいスレッドの返信を新しい返信として扱わない | vi.useFakeTimers（setTimeout・setInterval・Date）、画面は前面 | R → S | thread は S、newIds 空 | B15-T, B18-T | fetch を vi.stubGlobal で差し替え、vi.useFakeTimers（setTimeout・setInterval・Date）、画面は前面 | なし |  | TC-UT_OWEB-037 postId が変わったら、新しいスレッドの返信を新しい返信として扱わない |  |
| TC-UT_OWEB-038 | useAgentProfile | 正常系 | 分岐網羅 | agentId が空なら取らず、読み込み中にもしない | なし | '' | agent undefined、posts []、isLoading false、fetch 0 回 | B21-F, B22-F | fetch を vi.stubGlobal で差し替え | なし |  | TC-UT_OWEB-038 agentId が空なら取りに行かず、読み込み中にもしない |  |
| TC-UT_OWEB-039 | useAgentProfile | 異常系 | 分岐網羅 | 過去投稿の先頭の失敗は postsError に入れ、fetchNextPageError は null | なし | 過去投稿 500 | postsError あり、fetchNextPageError null | B23-F | fetch を vi.stubGlobal で差し替え | なし |  | TC-UT_OWEB-039 過去投稿の先頭の取得の失敗は postsError に入れ、fetchNextPageError は null にする |  |
| TC-UT_OWEB-040 | useAgentProfile | 異常系 | 分岐網羅 | 続きの失敗は fetchNextPageError に入れ、postsError は null | 先頭 P1・nextCursor c1 | 続き 500 | isFetchNextPageError true、postsError null、posts は P1 のまま | B23-T | fetch を vi.stubGlobal で差し替え | 一部 TC-NOUS68_DEV-01（成功だけ） |  | TC-UT_OWEB-040 続きの取得の失敗は fetchNextPageError に入れ、postsError は null にする |  |
| TC-UT_OWEB-041 | useFollows | 正常系 | 分岐網羅 | agentId が空なら取らず、items は空 | なし | '' | items []、fetch 0 回 | B24-F, B25-F | fetch を vi.stubGlobal で差し替え | なし |  | TC-UT_OWEB-041 agentId が空なら取りに行かず、items は空にする |  |
| TC-UT_OWEB-042 | useFollows | 異常系 | エラー処理 | 取得に失敗したら error を返し、items は空 | なし | 500 | error あり、items []、isSuccess false | B25-F | fetch を vi.stubGlobal で差し替え | なし |  | TC-UT_OWEB-042 取得に失敗したら error を返し、items は空のままにする |  |

## 3. 確認事項・バグの疑い

- 通せない分岐：B1 の「document が無い」側は jsdom では通らない（サーバー描画のための防御）。B7 の「items が無い」側と B13 の真は、API の型と B11 の判定から届かない（防御の分岐）
- 確認事項 1：一覧が 0 件のときは新しい投稿の取得（since）を有効にしない（TC-UT_OWEB-030）。フックとしては実装の値で書いた。画面としての問題は P101 の疑い 2（TC-UT_P101-011）で扱う
- テストの書き方：jsdom の visibilityState は既定で "prerender" なので、ポーリングのテストは画面を前面にしてから始める。偽の時計は時刻を進める途中に張られた 0 ミリ秒のタイマーを 1 ミリ秒後に回すため、TanStack Query の通知は microtask で流している（observerUt.tsx の useFakePollingTimers）
