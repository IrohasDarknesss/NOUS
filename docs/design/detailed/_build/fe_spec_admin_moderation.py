"""FE 詳細設計：管理画面 非表示・閲覧アクセス・アーカイブ（P209〜P211）。作成：Takaya Ishikawa（NOUS-37）。"""

P = "apps/admin/src"
SPEC = dict(
    name="admin_moderation", title="管理画面 非表示・閲覧アクセス・アーカイブ", author="Takaya Ishikawa（開発担当）", ticket="NOUS-37",
    inputs="画面基本設計書 P209 v1.2・P210 v1.3・P211 v1.2、BE 詳細設計 admin_data v1・admin_auth v1、FE 詳細設計 admin_control v1（共通部品）",
    history=[("v1", "2026-10-21", "初版作成", "Takaya Ishikawa")],
    domain="管理画面の投稿の非表示管理、招待リンクの管理、世界のアーカイブの参照。枠・API クライアント・エラーの扱い・共通部品は admin_control.md のものを使う",
    screens="P209、P210、P211",
    tree=f"""
{P}/
├── api/
│   ├── moderation.ts         # searchPosts・hidePost・unhidePost・listHideRecords
│   ├── invitations.ts        # listInvitations・issueInvitation・revokeInvitation
│   └── worlds.ts             # listWorlds・getArchivePosts・getArchiveGenerations
└── pages/
    ├── ModerationPage.tsx    # P209
    ├── moderation/ModerationTabs.tsx
    ├── moderation/PostSearchForm.tsx
    ├── moderation/PostModerationTable.tsx
    ├── moderation/HideReasonDialog.tsx
    ├── moderation/HideHistoryTable.tsx
    ├── InvitationsPage.tsx   # P210
    ├── invitations/IssueForm.tsx
    ├── invitations/IssuedLinkBox.tsx
    ├── invitations/InvitationTable.tsx
    ├── invitations/LanAddressNote.tsx
    ├── WorldArchivePage.tsx  # P211
    ├── worlds/WorldTable.tsx
    ├── worlds/ReadOnlyBanner.tsx
    ├── worlds/ArchiveTabs.tsx
    ├── worlds/ArchivePostTable.tsx
    └── worlds/ArchiveGenerationTable.tsx
""",
    routes=[
        ("/moderation", "ModerationPage（?postId= で1件を開く、?tab=history で履歴）", "要（RequireSession）", f"{P}/router.tsx"),
        ("/invitations", "InvitationsPage", "要", f"{P}/router.tsx"),
        ("/worlds", "WorldArchivePage（?worldId= と ?tab= で開く世界とタブ）", "要", f"{P}/router.tsx"),
    ],
    components=[
        ("ModerationPage", "Page", f"{P}/pages/ModerationPage.tsx", "-（URL の postId・tab）", "dialog: { mode, post } \\| null", "P209", ""),
        ("ModerationTabs", "UI", f"{P}/pages/moderation/ModerationTabs.tsx", "tab, onChange", "-", "投稿の検索・非表示の履歴", "ModerationPage"),
        ("PostSearchForm", "UI", f"{P}/pages/moderation/PostSearchForm.tsx", "query, agents, onSearch", "draft: SearchQuery, error: string \\| null", "本文・公開状態・エージェントの条件", "ModerationPage"),
        ("PostModerationTable", "UI", f"{P}/pages/moderation/PostModerationTable.tsx", "items, onHide, onUnhide, onOpenLog", "-", "投稿の表（本文はテキスト）と操作", "ModerationPage"),
        ("HideReasonDialog", "UI", f"{P}/pages/moderation/HideReasonDialog.tsx", "mode: 'hide' \\| 'unhide', post, onConfirm, onCancel", "reason: string, error: string \\| null, submitting: boolean", "理由の入力と確定", "ModerationPage"),
        ("HideHistoryTable", "UI", f"{P}/pages/moderation/HideHistoryTable.tsx", "items, onLoadMore", "-", "非表示と取り消しの履歴", "ModerationPage"),
        ("InvitationsPage", "Page", f"{P}/pages/InvitationsPage.tsx", "-", "issuedUrl: string \\| null, confirm: Invitation \\| null", "P210", ""),
        ("IssueForm", "UI", f"{P}/pages/invitations/IssueForm.tsx", "onIssue, submitting", "label: string, error: string \\| null", "表示名の入力と発行", "InvitationsPage"),
        ("IssuedLinkBox", "UI", f"{P}/pages/invitations/IssuedLinkBox.tsx", "url", "copied: boolean", "発行したリンク（一度だけ）とコピー、注意書き", "InvitationsPage"),
        ("InvitationTable", "UI", f"{P}/pages/invitations/InvitationTable.tsx", "items, onRevoke", "-", "招待の一覧と失効", "InvitationsPage"),
        ("LanAddressNote", "UI", f"{P}/pages/invitations/LanAddressNote.tsx", "lanAddress: string \\| null", "-", "「この端末の LAN のアドレス：…」。null なら警告の色で「ネットワークにつながっていません」", "InvitationsPage"),
        ("WorldArchivePage", "Page", f"{P}/pages/WorldArchivePage.tsx", "-（URL の worldId・tab）", "-", "P211", ""),
        ("WorldTable", "UI", f"{P}/pages/worlds/WorldTable.tsx", "items, onOpen", "-", "世界の一覧。アーカイブの行に「開く」", "WorldArchivePage"),
        ("ReadOnlyBanner", "UI", f"{P}/pages/worlds/ReadOnlyBanner.tsx", "world", "-", "「この世界はアーカイブです。内容は変更できません」", "WorldArchivePage"),
        ("ArchiveTabs", "UI", f"{P}/pages/worlds/ArchiveTabs.tsx", "tab, onChange", "-", "投稿・生成ログ", "WorldArchivePage"),
        ("ArchivePostTable", "UI", f"{P}/pages/worlds/ArchivePostTable.tsx", "items, onLoadMore", "-", "アーカイブの投稿（公開状態つき。操作なし）", "WorldArchivePage"),
        ("ArchiveGenerationTable", "UI", f"{P}/pages/worlds/ArchiveGenerationTable.tsx", "items, onRowClick, onLoadMore", "-", "アーカイブの生成イベント。行で P208（NOUS-36）", "WorldArchivePage"),
    ],
    global_state=[
        ("adminWorld", "AdminWorld", "管理画面全体（admin_control の useAdminWorld）", "undefined", "5 秒ごと", "TanStack Query（共通）"),
        ("postsQuery", "InfiniteData<PostPage>", "P209（キー ['admin','posts', query]）", "undefined", "検索・非表示・取り消しの後", "usePostSearch（useInfiniteQuery）"),
        ("hideRecordsQuery", "InfiniteData<HideRecordPage>", "P209（キー ['admin','hideRecords']）", "undefined", "履歴のタブ・非表示・取り消しの後", "useHideRecords（useInfiniteQuery）"),
        ("invitationsQuery", "{ items, lanAddress }", "P210（キー ['admin','invitations']）", "undefined", "表示・発行・失効の後", "useInvitations（useQuery）"),
        ("worldsQuery / archiveQuery", "{ items } / InfiniteData", "P211（キー ['admin','worlds'] / ['admin','archive', worldId, tab]）", "undefined", "表示・世界とタブの選択", "useWorlds・useArchive"),
    ],
    local_state=[
        ("ModerationPage", "dialog", "{ mode, post } \\| null", "null", "開いている理由のダイアログ"),
        ("HideReasonDialog", "reason", "string", "''", "理由の入力"),
        ("PostSearchForm", "draft", "SearchQuery", "URL の値", "検索の確定前の入力"),
        ("InvitationsPage", "issuedUrl", "string \\| null", "null", "発行したリンク。画面を離れると消える（保存しない）"),
        ("InvitationsPage", "confirm", "Invitation \\| null", "null", "失効の確認"),
        ("IssueForm", "label", "string", "''", "表示名の入力"),
        ("IssuedLinkBox", "copied", "boolean", "false", "コピーの表示"),
    ],
    persist=[
        ("なし", "保存しない", "-", "招待リンクのトークンはメモリだけに置き、localStorage・sessionStorage・URL に入れない。検索の条件と世界・タブの選択は URL の検索パラメータに持つ", "-"),
    ],
    flow="""
sequenceDiagram
    participant U as "管理者"
    participant I as "InvitationsPage"
    participant F as "adminFetch"
    participant B as "管理 API"
    U->>I: "表示名を入れて 発行"
    I->>F: "POST /admin/api/invitations { label }"
    F->>B: "要求（X-CSRF-Token）"
    alt "201"
        B-->>I: "{ invitationId, inviteUrl }"
        I->>I: "issuedUrl に入れて IssuedLinkBox を表示、一覧を取り直す"
        U->>I: "コピー"
        U->>I: "画面を離れる"
        I->>U: "「招待リンクはもう表示できません。コピーしましたか」"
    else "409 LAN_ADDRESS_NOT_FOUND"
        B-->>I: "様式②「この端末の LAN のアドレスが見つかりません…」"
    end
""",
    ipo=[
        ("searchPosts / hidePost / unhidePost / listHideRecords", "api/moderation.ts", "各 API の引数", "1. adminFetch で BE admin_data の各 API を呼ぶ", "Promise", "ApiError"),
        ("listInvitations / issueInvitation / revokeInvitation", "api/invitations.ts", "各 API の引数", "1. adminFetch で BE admin_auth の各 API を呼ぶ", "Promise", "ApiError"),
        ("listWorlds / getArchivePosts / getArchiveGenerations", "api/worlds.ts", "各 API の引数", "1. adminFetch で BE admin_data の各 API を呼ぶ", "Promise", "ApiError"),
        ("useModerationParams", "pages/ModerationPage.tsx", "なし", "1. useSearchParams から tab・postId・q・visibility・agentId を読む 2. 書き換えは replace", "{ params, setParams }", "なし"),
        ("usePostSearch", "pages/ModerationPage.tsx", "query", "1. useInfiniteQuery(['admin','posts', query]) 2. postId があれば1件だけ", "{ pages, fetchNextPage }", "なし"),
        ("submitSearch", "pages/moderation/PostSearchForm.tsx", "draft", "1. q が 51 字以上なら「50 字以内で入力してください」 2. setParams（postId は消す）", "void", "なし"),
        ("openHideDialog", "pages/ModerationPage.tsx", "post, mode", "1. dialog={ mode, post }", "void", "なし"),
        ("confirmHide", "pages/moderation/HideReasonDialog.tsx", "なし", "1. reason が 201 字以上なら「200 字以内で入力してください」 2. submitting=true 3. hide なら hidePost、unhide なら unhidePost 4. invalidate(['admin','posts'])・(['admin','hideRecords']) 5. トースト（hide は「非表示にしました。観察画面から見えなくなります」） 6. 閉じる", "Promise<void>", "ApiError（409 ALREADY_HIDDEN・NOT_HIDDEN は様式②と一覧の取り直し）"),
        ("useHideRecords", "pages/ModerationPage.tsx", "なし", "1. tab が history のときだけ useInfiniteQuery(['admin','hideRecords'])", "{ pages, fetchNextPage }", "なし"),
        ("openGenerationLog", "pages/moderation/PostModerationTable.tsx", "post", "1. /generations/{post.generationEventId} へ（NOUS-36 の P208）", "void", "なし"),
        ("useInvitations", "pages/InvitationsPage.tsx", "なし", "1. useQuery(['admin','invitations'])", "{ items, lanAddress }", "なし"),
        ("submitIssue", "pages/invitations/IssueForm.tsx", "label", "1. 前後の空白を除いて 1〜30 字か 2. onIssue(label) 3. 成功で label を空に", "Promise<void>", "ApiError"),
        ("issue", "pages/InvitationsPage.tsx", "label", "1. issueInvitation 2. issuedUrl=inviteUrl 3. invalidate(['admin','invitations'])", "Promise<void>", "ApiError（409 LAN_ADDRESS_NOT_FOUND は様式②）"),
        ("copyInviteUrl", "pages/invitations/IssuedLinkBox.tsx", "url", "1. navigator.clipboard.writeText 2. copied=true を 2 秒 3. 使えなければ入力欄に入れて全選択", "Promise<void>", "なし"),
        ("useLeaveGuard", "pages/InvitationsPage.tsx", "issuedUrl", "1. issuedUrl があるとき useBlocker で移動を止め、ConfirmDialog「招待リンクはもう表示できません。コピーしましたか」 2. beforeunload も設定", "void", "なし"),
        ("requestRevoke", "pages/InvitationsPage.tsx", "invitation", "1. confirm=invitation（「失効させますか。この招待では見られなくなります」）", "void", "なし"),
        ("revoke", "pages/InvitationsPage.tsx", "invitation", "1. revokeInvitation 2. invalidate 3. トースト「失効させました。次の閲覧から見られなくなります」", "Promise<void>", "ApiError（409 ALREADY_REVOKED は様式②）"),
        ("formatDateTime", "pages/invitations/InvitationTable.tsx", "iso: string \\| null", "1. null は「―」 2. JST の YYYY/MM/DD HH:MM", "string", "なし"),
        ("useArchiveParams", "pages/WorldArchivePage.tsx", "なし", "1. useSearchParams から worldId・tab（既定 posts）", "{ worldId, tab, set }", "なし"),
        ("useWorlds", "pages/WorldArchivePage.tsx", "なし", "1. useQuery(['admin','worlds'])", "{ items }", "なし"),
        ("useArchive", "pages/WorldArchivePage.tsx", "worldId, tab", "1. worldId があるときだけ 2. tab が posts なら getArchivePosts、generations なら getArchiveGenerations を useInfiniteQuery", "{ pages, fetchNextPage }", "なし"),
        ("openWorld", "pages/worlds/WorldTable.tsx", "world", "1. archived の行だけ 2. set({ worldId, tab: 'posts' }) 3. 内容の位置までスクロール", "void", "なし"),
        ("openArchiveEvent", "pages/worlds/ArchiveGenerationTable.tsx", "eventId", "1. /generations/{eventId} へ（P208。アーカイブの生成イベントも開ける）", "void", "なし"),
    ],
    actions=[
        ("P209", "ページ", "ページロード", "useModerationParams・usePostSearch", "検索（postId があれば1件）", "-"),
        ("P209", "検索", "Click / Enter", "submitSearch", "条件で検索", "-"),
        ("P209", "非表示にする", "Click", "openHideDialog('hide')", "理由のダイアログ", "-"),
        ("P209", "取り消す", "Click", "openHideDialog('unhide')", "理由のダイアログ", "-"),
        ("P209", "ダイアログの確定", "Click", "confirmHide", "非表示・取り消し", "-"),
        ("P209", "タブ", "Click", "setParams({ tab })", "検索・履歴の切り替え", "-"),
        ("P209", "生成ログ", "Click", "openGenerationLog", "生成イベントへ", "P208"),
        ("P210", "ページ", "ページロード", "useInvitations", "一覧と LAN のアドレス", "-"),
        ("P210", "発行", "Click", "submitIssue → issue", "発行", "-"),
        ("P210", "コピー", "Click", "copyInviteUrl", "コピー", "-"),
        ("P210", "失効させる", "Click", "requestRevoke → revoke", "確認と失効", "-"),
        ("P210", "画面の移動", "移動", "useLeaveGuard", "リンクの表示中の確認", "移動先"),
        ("P211", "ページ", "ページロード", "useWorlds・useArchive", "世界の一覧（worldId があれば内容も）", "-"),
        ("P211", "開く", "Click", "openWorld", "アーカイブの世界の内容", "-"),
        ("P211", "タブ", "Click", "set({ tab })", "投稿・生成ログ", "-"),
        ("P211", "生成イベントの行", "Click", "openArchiveEvent", "詳細へ", "P208"),
    ],
    validations=[
        ("P209", "本文の検索（H02）", "50 字以内", "length <= 50", "「50 字以内で入力してください」"),
        ("P209", "理由（H11）", "200 字以内", "length <= 200", "「200 字以内で入力してください」"),
        ("P210", "表示名（H01）", "必須、1〜30 字（前後の空白を除いて）", "1 <= trim().length <= 30", "「1〜30 字で入力してください」"),
    ],
    errors=[
        ("セッション切れ", "401", "様式①", "admin_control の useApiErrorHandler（OK で /login）", "ErrorModal"),
        ("投稿の状態が変わった", "409 ALREADY_HIDDEN・NOT_HIDDEN", "様式②", "「投稿の状態が変わったため、操作できませんでした。一覧を更新します」と取り直し", "ErrorBanner"),
        ("すでに失効", "409 ALREADY_REVOKED", "様式②", "「この招待はすでに失効しています」と取り直し", "ErrorBanner"),
        ("LAN のアドレスがない", "409 LAN_ADDRESS_NOT_FOUND", "様式②", "「この端末の LAN のアドレスが見つかりません。端末がネットワークにつながっているか確かめてください」", "ErrorBanner"),
        ("入力の誤り", "400 VALIDATION_ERROR", "様式④", "fields を各欄の下に", "FieldError"),
        ("世界が見つからない", "404 WORLD_NOT_FOUND", "様式③", "「この世界は見つかりません」と一覧へのリンク", "P211 の中の全画面表示"),
        ("サーバーのエラー", "500・通信エラー", "様式①", "「操作に失敗しました。時間をおいて再度お試しください」", "ErrorModal"),
    ],
)
