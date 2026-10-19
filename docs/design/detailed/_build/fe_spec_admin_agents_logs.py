"""FE 詳細設計：管理画面 エージェント・指標・生成ログ（P203・P204・P206〜P208）。作成：Mark Zuckerberg（NOUS-36）。"""

P = "apps/admin/src"
SPEC = dict(
    name="admin_agents_logs", title="管理画面 エージェント・指標・生成ログ", author="Mark Zuckerberg（開発担当）", ticket="NOUS-36",
    inputs="画面基本設計書 P203・P204・P206〜P208 v1.2、BE 詳細設計 admin_data v1、FE 詳細設計 admin_control v1（共通部品）",
    history=[("v1", "2026-10-21", "初版作成", "Mark Zuckerberg")],
    domain="管理画面のエージェント一覧・登録と編集、利用量と運用指標、生成ログの一覧と詳細。枠・API クライアント・エラーの扱い・共通部品は admin_control.md のもの（AdminLayout・adminFetch・useApiErrorHandler・shared/）を使う",
    screens="P203、P204、P206、P207、P208",
    tree=f"""
{P}/
├── api/
│   ├── agents.ts            # listAgents・createAgent・updateAgent・deleteAgent・stopAgent・resumeAgent
│   ├── metrics.ts           # getDailyMetrics
│   └── generations.ts       # listGenerations・getGeneration
└── pages/
    ├── AgentListPage.tsx    # P203
    ├── agents/AgentFilterTabs.tsx
    ├── agents/AgentTable.tsx
    ├── agents/AgentRowActions.tsx
    ├── AgentEditPage.tsx    # P204
    ├── agents/ActivityLevelRadio.tsx
    ├── agents/NoRealPersonCheckbox.tsx
    ├── agents/agentForm.ts  # フォームの型・初期値・検証（packages/shared の AgentInputSchema を使う）
    ├── MetricsPage.tsx      # P206
    ├── metrics/DateRangePicker.tsx
    ├── metrics/TodaySummary.tsx
    ├── metrics/UsageChart.tsx
    ├── metrics/ActivityChart.tsx
    ├── metrics/MetricsTable.tsx
    ├── GenerationListPage.tsx   # P207
    ├── generations/GenerationFilters.tsx
    ├── generations/GenerationTable.tsx
    ├── generations/StatusBadge.tsx
    ├── GenerationDetailPage.tsx # P208
    ├── generations/EventSummary.tsx
    ├── generations/InputSection.tsx
    ├── generations/PromptViewer.tsx
    ├── generations/AttemptTable.tsx
    ├── generations/ConsistencyFlags.tsx
    └── generations/ResultPostCard.tsx
""",
    routes=[
        ("/agents", "AgentListPage", "要（RequireSession）", f"{P}/router.tsx"),
        ("/agents/new", "AgentEditPage（新規）", "要", f"{P}/router.tsx"),
        ("/agents/:agentId/edit", "AgentEditPage（編集）", "要", f"{P}/router.tsx"),
        ("/metrics", "MetricsPage", "要", f"{P}/router.tsx"),
        ("/generations", "GenerationListPage", "要", f"{P}/router.tsx"),
        ("/generations/:eventId", "GenerationDetailPage", "要", f"{P}/router.tsx"),
    ],
    components=[
        ("AgentListPage", "Page", f"{P}/pages/AgentListPage.tsx", "-", "confirm: ConfirmState \\| null", "P203。一覧と停止・再開・削除", ""),
        ("AgentFilterTabs", "UI", f"{P}/pages/agents/AgentFilterTabs.tsx", "filter, counts, onChange", "-", "すべて・稼働・停止", "AgentListPage"),
        ("AgentTable", "UI", f"{P}/pages/agents/AgentTable.tsx", "items, worldState", "-", "DataTable（shared）で表を描く", "AgentListPage"),
        ("AgentRowActions", "UI", f"{P}/pages/agents/AgentRowActions.tsx", "agent, worldState, onStop, onResume, onDelete", "-", "状態に応じたボタン（停止・再開・編集・削除・生成ログ）", "AgentTable"),
        ("AgentEditPage", "Page", f"{P}/pages/AgentEditPage.tsx", "-（URL の agentId）", "form: AgentForm, errors: FieldErrors, saving: boolean, dirty: boolean", "P204。準備中でなければ編集できない案内だけ", ""),
        ("ActivityLevelRadio", "UI", f"{P}/pages/agents/ActivityLevelRadio.tsx", "value, onChange", "-", "1〜5 と参加の確率（0.30〜0.90）の説明", "AgentEditPage"),
        ("NoRealPersonCheckbox", "UI", f"{P}/pages/agents/NoRealPersonCheckbox.tsx", "checked, error?, onChange", "-", "実在の人物・機微な情報を含まないことの確認", "AgentEditPage"),
        ("MetricsPage", "Page", f"{P}/pages/MetricsPage.tsx", "-", "range: { from, to }", "P206。30 秒ごとの再取得（期間の終了が今日のとき）", ""),
        ("DateRangePicker", "UI", f"{P}/pages/metrics/DateRangePicker.tsx", "from, to, onChange", "error: string \\| null", "期間の入力と直近 7・14・30 日のボタン", "MetricsPage"),
        ("TodaySummary", "UI", f"{P}/pages/metrics/TodaySummary.tsx", "today: DailyMetricsItem, freeTier: number", "-", "今日の Neurons・呼び出し・概算費用 0 円", "MetricsPage"),
        ("UsageChart", "UI", f"{P}/pages/metrics/UsageChart.tsx", "items, freeTier, limit", "-", "Recharts の棒と、無料枠・日次上限の横線", "MetricsPage"),
        ("ActivityChart", "UI", f"{P}/pages/metrics/ActivityChart.tsx", "items", "-", "活発さ（棒）と応答率（線、右の軸 %）", "MetricsPage"),
        ("MetricsTable", "UI", f"{P}/pages/metrics/MetricsTable.tsx", "items, onErrorRateClick", "-", "日別の表。エラー率 5% 超を赤", "MetricsPage"),
        ("GenerationListPage", "Page", f"{P}/pages/GenerationListPage.tsx", "-（URL の検索パラメータ）", "-", "P207。絞り込みは URL に持つ", ""),
        ("GenerationFilters", "UI", f"{P}/pages/generations/GenerationFilters.tsx", "filters, agents, onChange, onSearchId", "eventIdInput: string", "エージェント・行動・状態・期間・実行 ID", "GenerationListPage"),
        ("GenerationTable", "UI", f"{P}/pages/generations/GenerationTable.tsx", "items, onRowClick", "-", "生成イベントの表", "GenerationListPage"),
        ("StatusBadge", "UI", f"{P}/pages/generations/StatusBadge.tsx", "status, failureKind", "-", "成功（緑）・失敗（赤）・取り消し（橙）・中断（灰）・実行中（青）", "GenerationTable"),
        ("GenerationDetailPage", "Page", f"{P}/pages/GenerationDetailPage.tsx", "-（URL の eventId）", "-", "P208", ""),
        ("EventSummary", "UI", f"{P}/pages/generations/EventSummary.tsx", "event", "copied: boolean", "概要と実行 ID のコピー", "GenerationDetailPage"),
        ("InputSection", "UI", f"{P}/pages/generations/InputSection.tsx", "event, refPosts", "-", "候補・属性・記憶・参照した投稿の表", "GenerationDetailPage"),
        ("PromptViewer", "UI", f"{P}/pages/generations/PromptViewer.tsx", "promptText, outputText", "expanded: boolean", "入力と出力の全文（等幅、折りたたみ）", "GenerationDetailPage"),
        ("AttemptTable", "UI", f"{P}/pages/generations/AttemptTable.tsx", "attempts", "-", "試行の表", "GenerationDetailPage"),
        ("ConsistencyFlags", "UI", f"{P}/pages/generations/ConsistencyFlags.tsx", "flags", "-", "矛盾の候補（C01〜C04 の日本語）", "GenerationDetailPage"),
        ("ResultPostCard", "UI", f"{P}/pages/generations/ResultPostCard.tsx", "post", "-", "生成された投稿と「非表示管理で開く」", "GenerationDetailPage"),
    ],
    global_state=[
        ("adminWorld", "AdminWorld", "管理画面全体（admin_control の useAdminWorld）", "undefined", "5 秒ごと", "TanStack Query（共通）"),
        ("agentsQuery", "{ items, worldState }", "P203・P204・P207（キー ['admin','agents', filter]）", "undefined", "表示・停止・再開・削除・保存の後", "useAgents（useQuery）"),
        ("metricsQuery", "MetricsView", "P206（キー ['admin','metrics', from, to]）", "undefined", "期間の変更・30 秒ごと", "useMetrics（useQuery）"),
        ("generationsQuery", "InfiniteData<GenerationPage>", "P207（キー ['admin','generations', filters]）", "undefined", "絞り込みの変更・続き", "useGenerations（useInfiniteQuery）"),
        ("generationDetail", "GenerationDetail", "P208（キー ['admin','generation', eventId]）", "undefined", "表示時", "useGeneration（useQuery）"),
    ],
    local_state=[
        ("AgentListPage", "confirm", "ConfirmState \\| null", "null", "停止・削除の確認のダイアログ"),
        ("AgentEditPage", "form", "AgentForm", "新規は既定（活動頻度 3、確認は未選択）、編集は取得した値", "入力値"),
        ("AgentEditPage", "errors", "FieldErrors", "{}", "項目ごとのエラー（様式④）"),
        ("AgentEditPage", "dirty", "boolean", "false", "取消・移動の確認"),
        ("DateRangePicker", "error", "string \\| null", "null", "期間の誤り"),
        ("GenerationFilters", "eventIdInput", "string", "''", "実行 ID の直接の入力"),
        ("PromptViewer", "expanded", "boolean", "false", "入力の全文の開閉"),
        ("EventSummary", "copied", "boolean", "false", "コピーの表示（2 秒）"),
    ],
    persist=[
        ("なし", "保存しない", "-", "絞り込みと期間は URL の検索パラメータに持ち、localStorage には置かない", "-"),
    ],
    flow="""
sequenceDiagram
    participant U as "管理者"
    participant E as "AgentEditPage"
    participant V as "agentForm（AgentInputSchema）"
    participant F as "adminFetch"
    participant B as "管理 API"
    U->>E: "保存 を押す"
    E->>V: "validateAgentForm(form)"
    alt "検証に失敗"
        V-->>E: "errors（様式④）"
    else "合格"
        E->>F: "POST /admin/api/agents（新規）または PUT（編集）"
        F->>B: "要求（X-CSRF-Token）"
        alt "409 HANDLE_TAKEN"
            B-->>E: "ハンドルの欄の下に「このハンドルは使われています」"
        else "200・201"
            E->>E: "invalidate(['admin','agents'])、/agents へ、トースト「保存しました」"
        end
    end
""",
    ipo=[
        ("listAgents / createAgent / updateAgent / deleteAgent / stopAgent / resumeAgent", "api/agents.ts", "各 API の引数", "1. adminFetch で BE admin_data の各 API を呼ぶ 2. 応答の型を返す", "Promise", "ApiError"),
        ("getDailyMetrics", "api/metrics.ts", "{ from, to }", "1. adminFetch('/admin/api/metrics/daily?from&to')", "Promise<MetricsView>", "ApiError"),
        ("listGenerations / getGeneration", "api/generations.ts", "filters / eventId", "1. URLSearchParams を組み立てて adminFetch", "Promise", "ApiError"),
        ("useAgents", "pages/AgentListPage.tsx", "filter: 'all' \\| 'active' \\| 'stopped'", "1. useQuery(['admin','agents', filter])", "{ items, worldState }", "なし"),
        ("handleStop", "pages/AgentListPage.tsx", "agent", "1. confirm を「停止しますか。次の行動機会から割り当てません」で開く 2. 確定で stopAgent 3. invalidate 4. トースト「停止しました。次の行動機会から割り当てません」", "Promise<void>", "ApiError（409 は様式②）"),
        ("handleResume", "pages/AgentListPage.tsx", "agent", "1. resumeAgent（確認なし） 2. invalidate", "Promise<void>", "ApiError"),
        ("handleDelete", "pages/AgentListPage.tsx", "agent", "1. confirm（danger）「削除しますか。元に戻せません」 2. deleteAgent 3. invalidate", "Promise<void>", "ApiError"),
        ("rowActionStates", "pages/agents/AgentRowActions.tsx", "agent, worldState", "1. 停止：agent が active かつ世界が preparing・archived でない 2. 再開：agent が stopped 3. 編集・削除：世界が preparing 4. 生成ログ：世界が preparing でない", "Record<Action, boolean>", "なし"),
        ("loadAgentForEdit", "pages/AgentEditPage.tsx", "agentId?: string", "1. 新規なら既定の form 2. 編集なら agentsQuery から対象を探し、なければ listAgents を取り直す 3. 見つからなければ様式③（エージェントが見つかりません）", "AgentForm", "なし"),
        ("validateAgentForm", "pages/agents/agentForm.ts", "form: AgentForm", "1. AgentInputSchema.safeParse 2. 失敗を項目ごとの日本語に変える（画面基本設計書 P204 の 6 章の文言）", "FieldErrors", "なし"),
        ("submitAgentForm", "pages/AgentEditPage.tsx", "なし", "1. validateAgentForm 2. 新規は createAgent、編集は updateAgent 3. 成功で dirty=false、/agents へ 4. 400 の fields と 409 HANDLE_TAKEN を errors に", "Promise<void>", "ApiError"),
        ("cancelAgentEdit", "pages/AgentEditPage.tsx", "なし", "1. dirty なら ConfirmDialog「入力を破棄しますか」 2. /agents へ", "void", "なし"),
        ("participationLabel", "pages/agents/ActivityLevelRadio.tsx", "level: 1〜5", "1. {1: 0.30, 2: 0.45, 3: 0.60, 4: 0.75, 5: 0.90} から「行動機会の約 N% で行動します」", "string", "なし"),
        ("useMetrics", "pages/MetricsPage.tsx", "range", "1. useQuery(['admin','metrics', from, to], refetchInterval は to が今日なら 30000)", "MetricsView", "なし"),
        ("validateRange", "pages/metrics/DateRangePicker.tsx", "from, to", "1. from > to なら「開始日は終了日より前にしてください」 2. 91 日以上なら「期間は 90 日以内にしてください」", "string \\| null", "なし"),
        ("presetRange", "pages/metrics/DateRangePicker.tsx", "days: 7 \\| 14 \\| 30", "1. to=今日（UTC の日付）、from=to−(days−1)", "{ from, to }", "なし"),
        ("formatRate", "pages/metrics/MetricsTable.tsx", "rate: number \\| null", "1. null は「―」 2. 百分率の小数 1 桁", "string", "なし"),
        ("openFailedLogs", "pages/metrics/MetricsTable.tsx", "usageDate", "1. /generations?status=failed&from={日の 00:00Z}&to={翌日の 00:00Z} へ", "void", "なし"),
        ("useGenerationFilters", "pages/GenerationListPage.tsx", "なし", "1. useSearchParams から filters を読み書きする 2. 変更で URL を置き換え", "{ filters, setFilters }", "なし"),
        ("useGenerations", "pages/GenerationListPage.tsx", "filters", "1. useInfiniteQuery(['admin','generations', filters], nextCursor)", "{ pages, fetchNextPage }", "なし"),
        ("searchByEventId", "pages/generations/GenerationFilters.tsx", "eventIdInput", "1. 26 字でなければ「実行 ID は 26 字です」 2. /generations/{id} へ", "void", "なし"),
        ("toLocalDateTime / toUtcIso", "pages/generations/GenerationFilters.tsx", "value", "1. JST の入力を UTC の ISO 8601 に、ISO を JST の表示に", "string", "なし"),
        ("useGeneration", "pages/GenerationDetailPage.tsx", "eventId", "1. useQuery(['admin','generation', eventId]) 2. 404 は様式③", "GenerationDetail", "なし"),
        ("copyEventId", "pages/generations/EventSummary.tsx", "eventId", "1. navigator.clipboard.writeText 2. copied=true を 2 秒", "Promise<void>", "クリップボードが使えなければ選択状態にする"),
        ("describeFlag", "pages/generations/ConsistencyFlags.tsx", "flag", "1. C01「解除した相手への 3 巡以内の返信」 C02「過去の発言の繰り返し」 C03「口調に合わない一人称」 C04「存在しない住人への言及」", "string", "なし"),
        ("openModeration", "pages/generations/ResultPostCard.tsx", "postId", "1. /moderation?postId={postId} へ（NOUS-37 の P209）", "void", "なし"),
    ],
    actions=[
        ("P203", "ページ", "ページロード", "useAgents", "一覧の取得", "-"),
        ("P203", "絞り込み", "Click", "setFilter → useAgents", "状態で絞る", "-"),
        ("P203", "停止", "Click", "handleStop", "確認と停止", "-"),
        ("P203", "再開", "Click", "handleResume", "再開", "-"),
        ("P203", "削除", "Click", "handleDelete", "確認と削除", "-"),
        ("P203", "新規登録・編集", "Click", "navigate", "登録・編集へ", "P204"),
        ("P203", "生成ログ", "Click", "navigate('/generations?agentId=')", "絞った生成ログへ", "P207"),
        ("P204", "保存", "Click", "submitAgentForm", "検証と保存", "P203"),
        ("P204", "取消", "Click", "cancelAgentEdit", "破棄の確認", "P203"),
        ("P204", "各入力欄", "Blur", "validateAgentForm（その欄）", "欄の検証", "-"),
        ("P206", "期間・既定の期間", "Change / Click", "validateRange・presetRange", "期間の変更と取得", "-"),
        ("P206", "表のエラー率", "Click", "openFailedLogs", "失敗の生成ログへ", "P207"),
        ("P207", "絞り込み", "Change", "useGenerationFilters", "URL の更新と取得", "-"),
        ("P207", "実行 ID", "Enter", "searchByEventId", "詳細へ", "P208"),
        ("P207", "表の行", "Click", "navigate", "詳細へ", "P208"),
        ("P207", "さらに読み込む", "Click", "fetchNextPage", "続き 50 件", "-"),
        ("P208", "コピー", "Click", "copyEventId", "実行 ID のコピー", "-"),
        ("P208", "入力の全文", "Click", "PromptViewer の開閉", "開閉", "-"),
        ("P208", "非表示管理で開く", "Click", "openModeration", "非表示管理へ", "P209"),
    ],
    validations=[
        ("P204", "ハンドル", "必須、3〜20 字、半角英数字と _", "^[A-Za-z0-9_]{3,20}$", "「入力してください」「3〜20 字の半角英数字と _ で入力してください」"),
        ("P204", "表示名", "必須、1〜30 字", "1 <= length <= 30", "「入力してください」「30 字以内で入力してください」"),
        ("P204", "自己紹介", "200 字以内", "length <= 200", "「200 字以内で入力してください」"),
        ("P204", "興味・関心分野・性格・価値観・主張傾向", "必須、各 1〜100 字", "1 <= length <= 100", "「入力してください」「100 字以内で入力してください」"),
        ("P204", "活動頻度", "必須、1〜5", "[1,2,3,4,5] のどれか", "「1〜5 から選んでください」"),
        ("P204", "確認の欄", "必須", "checked === true", "「確認の欄を選んでください」"),
        ("P206", "期間", "開始 ≦ 終了、90 日以内", "from <= to && days <= 90", "「開始日は終了日より前にしてください」「期間は 90 日以内にしてください」"),
        ("P207", "期間", "開始 ≦ 終了", "from <= to", "「開始は終了より前にしてください」"),
        ("P207", "実行 ID", "26 字の英数字", "^[0-9A-HJKMNP-TV-Z]{26}$", "「実行 ID は 26 字です」"),
    ],
    errors=[
        ("セッション切れ", "401", "様式①", "admin_control の useApiErrorHandler（OK で /login）", "ErrorModal"),
        ("状態の衝突（停止済み・再開済み・世界の開始後の保存）", "409 ALREADY_STOPPED・ALREADY_ACTIVE・STATE_CONFLICT", "様式②", "画面基本設計書 P203・P204 の文言。一覧を取り直す", "ErrorBanner"),
        ("ハンドルの重複", "409 HANDLE_TAKEN", "様式④", "ハンドルの欄の下に「このハンドルは使われています」", "FieldError"),
        ("入力の誤り", "400 VALIDATION_ERROR", "様式④", "fields を各欄の下に", "FieldError"),
        ("生成イベントがない", "404 EVENT_NOT_FOUND", "様式③", "「生成イベントが見つかりません」と一覧へのリンク", "FullPageError（admin_control の shared に追加しない。P208 の中で描く）"),
        ("指標の再取得の連続の失敗", "500・通信エラー（3 回）", "様式②", "「最新の指標を取得できていません」", "ErrorBanner"),
        ("サーバーのエラー", "500・通信エラー", "様式①", "「処理に失敗しました。時間をおいて再度お試しください」", "ErrorModal"),
    ],
)
