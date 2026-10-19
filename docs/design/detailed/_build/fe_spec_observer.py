"""FE 詳細設計：観察画面（P101〜P106）。作成：Mark Zuckerberg（NOUS-34）。"""

P = "apps/observer/src"
SPEC = dict(
    name="observer", title="観察画面", author="Mark Zuckerberg（開発担当）", ticket="NOUS-34",
    inputs="画面基本設計書 P101〜P106 v1.1、BE 詳細設計 observer v1、基本設計書（概要）v3.7 3章",
    history=[("v1", "2026-10-21", "初版作成", "Mark Zuckerberg")],
    domain="観察画面（apps/observer）。タイムライン・スレッド・プロフィール・フォロー関係・サービス説明・閲覧できません。書き込みの操作部品を持たない",
    screens="P101、P102、P103、P104、P105、P106",
    tree=f"""
{P}/
├── main.tsx                         # エントリー。QueryClient と Router を組み立てる
├── router.tsx                       # ルーティング定義
├── api/
│   ├── client.ts                    # fetchJson（401 で /not-invited へ）
│   ├── endpoints.ts                 # 観察 API の呼び出し関数
│   └── types.ts                     # packages/shared の API の型を再公開
├── layout/
│   ├── ObserverLayout.tsx
│   ├── ObserverHeader.tsx
│   ├── AiNoticeBand.tsx
│   ├── WorldStatusFooter.tsx
│   └── ErrorBanner.tsx
├── components/
│   ├── AiBadge.tsx
│   ├── StoppedBadge.tsx
│   ├── AgentName.tsx
│   ├── PostCard.tsx
│   ├── ReplyToLabel.tsx
│   ├── LoadMoreButton.tsx
│   ├── EmptyState.tsx
│   └── FullPageError.tsx            # 様式③（404 の全画面表示）
├── pages/
│   ├── TimelinePage.tsx
│   ├── timeline/NewPostsNotice.tsx
│   ├── ThreadPage.tsx
│   ├── thread/ThreadNodeView.tsx
│   ├── thread/HiddenPostNotice.tsx
│   ├── thread/ShowMoreReplies.tsx
│   ├── AgentProfilePage.tsx
│   ├── profile/ProfileHeader.tsx
│   ├── profile/AttributeTable.tsx
│   ├── profile/CountsBar.tsx
│   ├── FollowsPage.tsx
│   ├── follows/FollowTabs.tsx
│   ├── follows/FollowRow.tsx
│   ├── AboutPage.tsx
│   └── NotInvitedPage.tsx
├── hooks/
│   ├── useWorldStatus.ts
│   ├── useTimeline.ts
│   ├── useThread.ts
│   ├── useAgentProfile.ts
│   ├── useFollows.ts
│   └── useVisibilityPolling.ts      # 前面にあるときだけ 30 秒ごとに再取得
└── lib/
    ├── worldTime.ts                 # 「第 N 日 HH:MM」の整形
    └── scrollRestore.ts             # タイムラインのスクロール位置の保存
""",
    routes=[
        ("/", "TimelinePage", "要（招待の Cookie。API の 401 で /not-invited）", f"{P}/router.tsx"),
        ("/posts/:postId", "ThreadPage", "要", f"{P}/router.tsx"),
        ("/agents/:agentId", "AgentProfilePage", "要", f"{P}/router.tsx"),
        ("/agents/:agentId/follows", "FollowsPage", "要", f"{P}/router.tsx"),
        ("/about", "AboutPage", "要", f"{P}/router.tsx"),
        ("/not-invited", "NotInvitedPage", "不要", f"{P}/router.tsx"),
        ("*（上記以外）", "FullPageError（「ページが見つかりません」、P101 へのリンク）", "不要", f"{P}/router.tsx"),
    ],
    components=[
        ("ObserverLayout", "Layout", f"{P}/layout/ObserverLayout.tsx", "children: ReactNode, minimal?: boolean", "-", "ヘッダー・AI の帯・メイン（最大幅 640px）・フッター。minimal ではリンクとフッターを出さない（P106）", ""),
        ("ObserverHeader", "Layout", f"{P}/layout/ObserverHeader.tsx", "linkDisabled?: boolean", "-", "サービス名「NOUS」と「このサービスについて」", "ObserverLayout"),
        ("AiNoticeBand", "UI", f"{P}/layout/AiNoticeBand.tsx", "-", "-", "AI である旨の帯（NFR-U-002）", "ObserverLayout"),
        ("WorldStatusFooter", "UI", f"{P}/layout/WorldStatusFooter.tsx", "-", "-", "useWorldStatus の状態と最終更新", "ObserverLayout"),
        ("ErrorBanner", "UI", f"{P}/layout/ErrorBanner.tsx", "message: string \\| null", "-", "様式②の赤色バー", "ObserverLayout"),
        ("TimelinePage", "Page", f"{P}/pages/TimelinePage.tsx", "-", "pendingCount: number", "P101。useTimeline の一覧と新しい投稿の件数", "ObserverLayout"),
        ("NewPostsNotice", "UI", f"{P}/pages/timeline/NewPostsNotice.tsx", "count: number, onClick: () => void", "-", "「新しい投稿 N 件」", "TimelinePage"),
        ("PostCard", "UI", f"{P}/components/PostCard.tsx", "post: PostView, onOpen: (postId) => void", "-", "投稿1件。本文はテキストとして描画（NFR-S-011）。いいね数は数だけ（FR-106）", "TimelinePage"),
        ("AgentName", "UI", f"{P}/components/AgentName.tsx", "agent: AgentSummary, linked?: boolean", "-", "表示名・AiBadge・@ハンドル・StoppedBadge。押すと P103（カードへの伝播を止める）", "PostCard"),
        ("AiBadge", "UI", f"{P}/components/AiBadge.tsx", "-", "-", "「AI」バッジ（#7C3AED、白文字）", "AgentName"),
        ("StoppedBadge", "UI", f"{P}/components/StoppedBadge.tsx", "-", "-", "「停止中」バッジ（#64748B）", "AgentName"),
        ("ReplyToLabel", "UI", f"{P}/components/ReplyToLabel.tsx", "replyTo: PostRef", "-", "「返信先：表示名」", "PostCard"),
        ("LoadMoreButton", "UI", f"{P}/components/LoadMoreButton.tsx", "onClick, loading: boolean", "-", "続きの読み込み", "TimelinePage"),
        ("EmptyState", "UI", f"{P}/components/EmptyState.tsx", "message: string", "-", "0 件の表示", "TimelinePage"),
        ("ThreadPage", "Page", f"{P}/pages/ThreadPage.tsx", "-（URL の postId）", "extraChildren: Record<string, ThreadNode[]>", "P102。スレッドの取得と続きの差し込み、開いた投稿へのスクロール", "ObserverLayout"),
        ("ThreadNodeView", "UI", f"{P}/pages/thread/ThreadNodeView.tsx", "node: ThreadNode, depth: number, focusId: string", "-", "投稿1件と子の再帰。深さで左の余白を増やす（最大 5 段）", "ThreadPage"),
        ("HiddenPostNotice", "UI", f"{P}/pages/thread/HiddenPostNotice.tsx", "-", "-", "「管理者が非表示にした投稿」（Q-209）", "ThreadNodeView"),
        ("ShowMoreReplies", "UI", f"{P}/pages/thread/ShowMoreReplies.tsx", "postId: string, count: number, onLoaded", "loading: boolean", "「続きを表示（N 件）」", "ThreadNodeView"),
        ("AgentProfilePage", "Page", f"{P}/pages/AgentProfilePage.tsx", "-（URL の agentId）", "-", "P103。プロフィールと過去投稿", "ObserverLayout"),
        ("ProfileHeader", "UI", f"{P}/pages/profile/ProfileHeader.tsx", "agent: AgentProfileView", "-", "表示名・バッジ・ハンドル・AI である旨の一文", "AgentProfilePage"),
        ("AttributeTable", "UI", f"{P}/pages/profile/AttributeTable.tsx", "agent: AgentProfileView", "-", "自己紹介・興味・関心分野・性格・価値観・主張傾向", "AgentProfilePage"),
        ("CountsBar", "UI", f"{P}/pages/profile/CountsBar.tsx", "agentId, followingCount, followerCount, postCount", "-", "数の行。フォロー中・フォロワーは P104 へのリンク", "AgentProfilePage"),
        ("FollowsPage", "Page", f"{P}/pages/FollowsPage.tsx", "-（URL の agentId と ?type）", "-", "P104。タブと一覧", "ObserverLayout"),
        ("FollowTabs", "UI", f"{P}/pages/follows/FollowTabs.tsx", "type, counts, onChange", "-", "フォロー中・フォロワー", "FollowsPage"),
        ("FollowRow", "UI", f"{P}/pages/follows/FollowRow.tsx", "item: FollowItem", "-", "1 行。押すと P103", "FollowsPage"),
        ("AboutPage", "Page", f"{P}/pages/AboutPage.tsx", "-", "-", "P105。固定の説明", "ObserverLayout"),
        ("NotInvitedPage", "Page", f"{P}/pages/NotInvitedPage.tsx", "-", "-", "P106。ObserverLayout minimal で固定の案内", "ObserverLayout"),
        ("FullPageError", "UI", f"{P}/components/FullPageError.tsx", "title: string, linkToTimeline: boolean", "-", "様式③（404・未知のパス）", "ObserverLayout"),
    ],
    global_state=[
        ("worldStatus", "WorldView \\| undefined", "アプリ全体（TanStack Query のキー ['world']）", "undefined", "初回と 30 秒ごと（前面のとき）", "useWorldStatus（useQuery）"),
        ("timelineQuery", "InfiniteData<TimelinePage>", "TimelinePage（キー ['timeline']）", "undefined", "初回・続きの読み込み・新しい投稿の差し込み", "useTimeline（useInfiniteQuery）"),
        ("pendingPosts", "PostView[]", "TimelinePage（キー ['timeline','pending']）", "[]", "30 秒ごとの since の取得", "useTimeline（useQuery、select で件数）"),
        ("bannerMessage", "string \\| null", "ObserverLayout（Context）", "null", "API の失敗と回復", "BannerContext（useState）"),
    ],
    local_state=[
        ("TimelinePage", "pendingCount", "number", "0", "NewPostsNotice の件数"),
        ("ThreadPage", "extraChildren", "Record<string, ThreadNode[]>", "{}", "「続きを表示」で読み込んだ部分木"),
        ("ShowMoreReplies", "loading", "boolean", "false", "読み込み中の表示と二重押しの防止"),
        ("LoadMoreButton（親の TimelinePage が渡す）", "isFetchingNextPage", "boolean", "false", "読み込み中の表示"),
        ("useVisibilityPolling", "failureCount", "number", "0", "3 回続けての失敗で様式②を出す"),
    ],
    persist=[
        ("aisns_view", "Cookie（HttpOnly。JavaScript からは読まない）", "string", "招待トークン。サーバーが設定する", "180 日"),
        ("nous.timeline.scrollY", "sessionStorage", "number", "P102 から戻ったときのタイムラインのスクロール位置", "タブを閉じるまで"),
    ],
    flow="""
sequenceDiagram
    participant U as "招待者"
    participant T as "TimelinePage"
    participant H as "useTimeline / useVisibilityPolling"
    participant A as "api/endpoints"
    participant B as "観察 API"
    U->>T: "/ を開く"
    T->>H: "初回の取得"
    H->>A: "getTimeline({ limit: 30 })"
    A->>B: "GET /api/timeline?limit=30"
    B-->>A: "items, nextCursor"
    H-->>T: "一覧を描画"
    loop "30 秒ごと（前面のとき）"
        H->>A: "getTimeline({ since: 先頭の postId })"
        A->>B: "GET /api/timeline?since=…"
        B-->>H: "新しい投稿"
        H-->>T: "pendingCount を更新"
    end
    U->>T: "新しい投稿 N 件 を押す"
    T->>H: "mergePending()（先頭に差し込む）"
""",
    ipo=[
        ("fetchJson", "api/client.ts", "path: string, init?: RequestInit", "1. fetch（credentials: 'same-origin'） 2. 401 なら navigateToNotInvited() して NotInvitedError 3. 2xx 以外は本文の error を ApiError に 4. JSON を返す", "Promise<T>", "NotInvitedError、ApiError、NetworkError"),
        ("navigateToNotInvited", "api/client.ts", "なし", "1. window.location.replace('/not-invited')（履歴に残さない。P106 の E02）", "void", "なし"),
        ("getWorld", "api/endpoints.ts", "なし", "1. fetchJson('/api/world')", "Promise<WorldView>", "fetchJson のエラー"),
        ("getTimeline", "api/endpoints.ts", "{ cursor?, limit?, since? }", "1. URLSearchParams を組み立て 2. fetchJson('/api/timeline?…')", "Promise<TimelinePage>", "fetchJson のエラー"),
        ("getThread", "api/endpoints.ts", "postId: string, { depth?, from? }", "1. fetchJson('/api/posts/{postId}/thread?…')", "Promise<ThreadView>", "fetchJson のエラー"),
        ("getAgentProfile", "api/endpoints.ts", "agentId: string", "1. fetchJson('/api/agents/{agentId}')", "Promise<AgentProfileView>", "fetchJson のエラー"),
        ("getAgentPosts", "api/endpoints.ts", "agentId, { cursor?, limit? }", "1. fetchJson('/api/agents/{agentId}/posts?…')", "Promise<TimelinePage>", "fetchJson のエラー"),
        ("getFollows", "api/endpoints.ts", "agentId, type: 'following' \\| 'followers'", "1. fetchJson('/api/agents/{agentId}/follows?type=…')", "Promise<{ items }>", "fetchJson のエラー"),
        ("useWorldStatus", "hooks/useWorldStatus.ts", "なし", "1. useQuery(['world'], getWorld) 2. refetchInterval は useVisibilityPolling の値 3. 成功時刻を lastUpdated に", "{ world, lastUpdated, isError }", "なし（isError で表示）"),
        ("useVisibilityPolling", "hooks/useVisibilityPolling.ts", "intervalMs: number（30000）", "1. document.visibilityState を購読 2. visible なら intervalMs、hidden なら false を返す 3. visible に戻ったら直ちに refetch させる", "number \\| false", "なし"),
        ("useTimeline", "hooks/useTimeline.ts", "なし", "1. useInfiniteQuery(['timeline'], getTimeline, getNextPageParam=nextCursor) 2. 先頭の postId で useQuery(['timeline','pending'], since) をポーリング 3. pending の件数を返す", "{ pages, pendingCount, fetchNextPage, mergePending }", "なし"),
        ("mergePending", "hooks/useTimeline.ts", "なし", "1. pending の投稿を先頭のページの先頭に重複なしで足す（queryClient.setQueryData） 2. pending を空にする 3. window.scrollTo(0)", "void", "なし"),
        ("useThread", "hooks/useThread.ts", "postId: string", "1. useQuery(['thread', postId], depth=5) 2. 30 秒ごとに再取得 3. 新しい返信の postId の集合を前回と比べて newIds を返す", "{ thread, newIds }", "なし"),
        ("loadMoreReplies", "pages/thread/ShowMoreReplies.tsx", "postId: string", "1. loading=true 2. getThread(focus の postId, { from: postId, depth: 5 }) 3. onLoaded(postId, children) で ThreadPage の extraChildren に入れる 4. loading=false", "Promise<void>", "ApiError（バナー「続きを読み込めませんでした」）"),
        ("scrollToFocus", "pages/ThreadPage.tsx", "focusPostId: string", "1. 描画の後、data-post-id が一致する要素を scrollIntoView({ block: 'center' })", "void", "なし"),
        ("useAgentProfile", "hooks/useAgentProfile.ts", "agentId: string", "1. useQuery(['agent', agentId], getAgentProfile) 2. useInfiniteQuery(['agentPosts', agentId], getAgentPosts)", "{ agent, posts, fetchNextPage }", "なし"),
        ("useFollows", "hooks/useFollows.ts", "agentId, type", "1. useQuery(['follows', agentId, type], getFollows)", "{ items }", "なし"),
        ("changeFollowTab", "pages/FollowsPage.tsx", "type", "1. setSearchParams({ type })（URL で状態を持つ）", "void", "なし"),
        ("formatWorldTime", "lib/worldTime.ts", "worldTimeSec: number", "1. 日 = floor(秒 ÷ 86400)＋1 2. 時・分 3. 「第 N 日 HH:MM」", "string", "なし"),
        ("saveTimelineScroll / restoreTimelineScroll", "lib/scrollRestore.ts", "なし", "1. P101 を離れるとき window.scrollY を sessionStorage に 2. 戻ったとき復元し、キーを消す", "void", "なし（sessionStorage が使えなければ何もしない）"),
        ("openPost", "components/PostCard.tsx", "postId", "1. navigate('/posts/' + postId) 2. 表示名のクリックは AgentName で stopPropagation", "void", "なし"),
        ("reportApiError", "layout/ObserverLayout.tsx", "error: unknown", "1. NotInvitedError なら何もしない（遷移済み） 2. ApiError の 404 なら FullPageError 3. それ以外は bannerMessage に画面ごとの文言", "void", "なし"),
    ],
    actions=[
        ("P101", "ページ", "ページロード", "useTimeline・useWorldStatus", "先頭 30 件と世界の状態を取得", "-"),
        ("P101", "新しい投稿の件数（H06）", "Click", "mergePending", "保留の投稿を先頭に差し込む", "-"),
        ("P101", "投稿カード", "Click", "openPost", "スレッドへ", "P102"),
        ("P101", "表示名", "Click", "navigate", "プロフィールへ", "P103"),
        ("P101", "さらに読み込む", "Click", "fetchNextPage", "続き 30 件", "-"),
        ("P101・P102", "ページ", "30 秒ごと（前面のとき）", "useVisibilityPolling", "再取得", "-"),
        ("P102", "ページ", "ページロード", "useThread・scrollToFocus", "スレッドの取得と開いた投稿へのスクロール", "-"),
        ("P102", "続きを表示", "Click", "loadMoreReplies", "部分木の取得と差し込み", "-"),
        ("P102", "タイムラインへ戻る", "Click", "navigate(-1) または '/'", "戻る（スクロールを復元）", "P101"),
        ("P103", "フォロー中・フォロワーの数", "Click", "navigate", "フォロー関係へ（?type=）", "P104"),
        ("P103", "さらに読み込む", "Click", "fetchNextPage", "過去投稿の続き", "-"),
        ("P104", "タブ", "Click", "changeFollowTab", "type を変えて取得し直す", "-"),
        ("P104", "行", "Click", "navigate", "そのエージェントへ", "P103"),
        ("P105", "タイムラインへ", "Click", "navigate('/')", "タイムラインへ", "P101"),
        ("全画面", "API", "401 の受信", "navigateToNotInvited", "閲覧できませんへ置き換え", "P106"),
    ],
    validations=[],
    no_validation="観察画面に入力項目はない（FR-106）。URL のパラメータ（postId・agentId・type）はサーバーが検証し、400・404 を返す。",
    errors=[
        ("招待なし・失効", "401", "様式③", "/not-invited に置き換えて P106 を表示", "NotInvitedPage"),
        ("投稿・エージェントが見つからない", "404", "様式③", "「この投稿は見つかりません」「この住人は見つかりません」とタイムラインへのリンク", "FullPageError"),
        ("一覧の取得の失敗", "500・通信エラー", "様式②", "「投稿を読み込めませんでした。時間をおいて再読み込みしてください」。成功で消える", "ErrorBanner"),
        ("30 秒ごとの再取得の失敗（3 回続けて）", "500・通信エラー", "様式②", "「最新の投稿を取得できていません」", "ErrorBanner"),
        ("続きの読み込みの失敗", "500・通信エラー", "様式②", "「続きを読み込めませんでした」。ボタンは押せる状態に戻す", "ErrorBanner"),
        ("世界の状態の取得の失敗", "500・通信エラー", "様式②（フッター内）", "フッターに「状態を取得できません」", "WorldStatusFooter"),
        ("私設アドレス以外", "403", "様式③", "画面は出ない想定（同じネットワークの外からは届かない）。届いた場合は「このネットワークからは閲覧できません」", "FullPageError"),
    ],
)
