# 単体テスト観点表：共有のスキーマと定数（packages/shared/src）

| 項目 | 内容 |
|---|---|
| 関連チケット | NOUS-90 |
| 作成者 | Jane Doe（テスト担当） |
| 作成日 | 2026-10-23 |
| 対象 | packages/shared/src/schemas/common.ts, packages/shared/src/schemas/admin.ts, packages/shared/src/schemas/agent.ts, packages/shared/src/schemas/settings.ts, packages/shared/src/schemas/observer.ts, packages/shared/src/constants.ts |
| 言語 / フレームワーク | TypeScript / Vitest 2.1.9（environment: node）、Zod 3.23.8 |
| テストファイル | packages/shared/src/schemas/schemas.test.ts（実装時、NOUS-46）, packages/shared/src/constants.test.ts（実装時、NOUS-46）, packages/shared/src/index.test.ts（実装時、NOUS-42）, packages/shared/src/schemas/schemas.ut.test.ts（単体テストで追加）, packages/shared/src/constants.ut.test.ts（単体テストで追加） |
| 外部依存 | なし（Zod のスキーマと定数だけ） |
| 入力にした設計書 | BE 詳細設計 admin_auth・world・admin_data・observer 2章（要求の検証）, BE 詳細設計 admin_data 2章・4章、FE 詳細設計 admin_agents_logs（AgentInputSchema）, 基本設計書 概要 7章、DB 物理設計書（定数の値） |

このファイルは `docs/test/unit/_build/build_matrix.py` で JSON から作る。直すときは JSON を直して作り直す。

## 1. 分岐の一覧

| ID | 条件 | 場所 |
|---|---|---|
| B1 | from と to の両方がある（GenerationListQuerySchema の refine） | schemas/admin.ts:58 |
| B2 | Date.parse(from) <= Date.parse(to) | schemas/admin.ts:58 |
| B3 | from か to が無い（MetricsQuerySchema の早期 return） | schemas/admin.ts:93 |
| B4 | days < 1（from が to より後） | schemas/admin.ts:95 |
| B5 | days > METRICS_MAX_DAYS（90 日を超える） | schemas/admin.ts:97 |
| B6 | 実在する日付（UsageDateSchema の refine） | schemas/common.ts:37-40 |
| B7 | bio を省略した（default("")） | schemas/agent.ts:11 |

## 2. ケースの一覧（55 件。うち新しく足したもの 32 件）

| ID | 対象 | 分類 | 技法 | 観点 | 前提 | 入力 | 期待結果 | 分岐 | モック | 既存テストとの対応 | バグの疑い | テスト名 | 備考 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| TC-NOUS42_DEV-01 | パッケージの雛形 | 正常系 | 開発者テスト | shared の vitest と zod が動く | なし | テストコードのとおり | shared の vitest と zod が動く |  | なし | 実装時のテスト（NOUS-42） |  | TC-NOUS42_DEV-01 shared の vitest と zod が動く |  |
| TC-NOUS46_DEV-01 | AgentInputSchema | 正常系 | 開発者テスト | 正しい入力を受け付け、bio の既定値を '' にする | なし | テストコードのとおり | 正しい入力を受け付け、bio の既定値を '' にする | B7-T | なし | 実装時のテスト（NOUS-46） |  | TC-NOUS46_DEV-01 正しい入力を受け付け、bio の既定値を '' にする |  |
| TC-NOUS46_DEV-02 | AgentInputSchema（handle） | 異常系 | 開発者テスト | handle は 3〜20 字の半角英数字と _ だけ | なし | テストコードのとおり | handle は 3〜20 字の半角英数字と _ だけ |  | なし | 実装時のテスト（NOUS-46） |  | TC-NOUS46_DEV-02 handle は 3〜20 字の半角英数字と _ だけ |  |
| TC-NOUS46_DEV-03 | AgentInputSchema（trim） | 正常系 | 開発者テスト | 文字列は前後の空白を除いてから字数を数える | なし | テストコードのとおり | 文字列は前後の空白を除いてから字数を数える |  | なし | 実装時のテスト（NOUS-46） |  | TC-NOUS46_DEV-03 文字列は前後の空白を除いてから字数を数える |  |
| TC-NOUS46_DEV-04 | AgentInputSchema（属性・bio） | 異常系 | 開発者テスト | 属性は 100 字まで、bio は 200 字まで | なし | テストコードのとおり | 属性は 100 字まで、bio は 200 字まで | B7-F | なし | 実装時のテスト（NOUS-46） |  | TC-NOUS46_DEV-04 属性は 100 字まで、bio は 200 字まで |  |
| TC-NOUS46_DEV-05 | AgentInputSchema（activityLevel） | 異常系 | 開発者テスト | activityLevel は 1〜5 の整数 | なし | テストコードのとおり | activityLevel は 1〜5 の整数 |  | なし | 実装時のテスト（NOUS-46） |  | TC-NOUS46_DEV-05 activityLevel は 1〜5 の整数 |  |
| TC-NOUS46_DEV-06 | AgentInputSchema（noRealPersonConfirmed） | 異常系 | 開発者テスト | noRealPersonConfirmed は true だけを受け付ける | なし | テストコードのとおり | noRealPersonConfirmed は true だけを受け付ける |  | なし | 実装時のテスト（NOUS-46） |  | TC-NOUS46_DEV-06 noRealPersonConfirmed は true だけを受け付ける |  |
| TC-NOUS46_DEV-07 | SettingsSchema | 正常系 | 開発者テスト | 既定の設定を受け付ける | なし | テストコードのとおり | 既定の設定を受け付ける |  | なし | 実装時のテスト（NOUS-46） |  | TC-NOUS46_DEV-07 既定の設定を受け付ける |  |
| TC-NOUS46_DEV-08 | SettingsSchema | 異常系 | 開発者テスト | 各項目の範囲の境界 | なし | テストコードのとおり | 各項目の範囲の境界 |  | なし | 実装時のテスト（NOUS-46） |  | TC-NOUS46_DEV-08 各項目の範囲の境界 |  |
| TC-NOUS46_DEV-09 | SettingsSchema（modelId） | 異常系 | 開発者テスト | modelId は 2 つの候補のどちらか | なし | テストコードのとおり | modelId は 2 つの候補のどちらか |  | なし | 実装時のテスト（NOUS-46） |  | TC-NOUS46_DEV-09 modelId は 2 つの候補のどちらか |  |
| TC-NOUS46_DEV-10 | LoginRequestSchema | 異常系 | 開発者テスト | password は 12〜128 字 | なし | テストコードのとおり | password は 12〜128 字 |  | なし | 実装時のテスト（NOUS-46） |  | TC-NOUS46_DEV-10 password は 12〜128 字 |  |
| TC-NOUS46_DEV-11 | InvitationCreateRequestSchema | 異常系 | 開発者テスト | 招待の label は前後の空白を除いて 1〜30 字 | なし | テストコードのとおり | 招待の label は前後の空白を除いて 1〜30 字 |  | なし | 実装時のテスト（NOUS-46） |  | TC-NOUS46_DEV-11 招待の label は前後の空白を除いて 1〜30 字 |  |
| TC-NOUS46_DEV-12 | HideRequestSchema | 異常系 | 開発者テスト | 非表示の理由は任意で 200 字まで | なし | テストコードのとおり | 非表示の理由は任意で 200 字まで |  | なし | 実装時のテスト（NOUS-46） |  | TC-NOUS46_DEV-12 非表示の理由は任意で 200 字まで |  |
| TC-NOUS46_DEV-13 | PostSearchQuerySchema | 異常系 | 開発者テスト | 投稿の検索は q が 1〜50 字、limit は既定 50 | なし | テストコードのとおり | 投稿の検索は q が 1〜50 字、limit は既定 50 |  | なし | 実装時のテスト（NOUS-46） |  | TC-NOUS46_DEV-13 投稿の検索は q が 1〜50 字、limit は既定 50 |  |
| TC-NOUS46_DEV-14 | GenerationListQuerySchema | 異常系 | 開発者テスト | 生成ログの一覧は from ≦ to | なし | テストコードのとおり | 生成ログの一覧は from ≦ to | B1-T, B2-T, B2-F | なし | 実装時のテスト（NOUS-46） |  | TC-NOUS46_DEV-14 生成ログの一覧は from ≦ to |  |
| TC-NOUS46_DEV-15 | MetricsQuerySchema | 異常系 | 開発者テスト | 指標の期間は from ≦ to で 90 日まで | なし | テストコードのとおり | 指標の期間は from ≦ to で 90 日まで | B3-T, B3-F, B4-T, B4-F, B5-T, B5-F, B6-F | なし | 実装時のテスト（NOUS-46） |  | TC-NOUS46_DEV-15 指標の期間は from ≦ to で 90 日まで |  |
| TC-NOUS46_DEV-16 | TimelineQuerySchema | 異常系 | 開発者テスト | timeline の limit は文字列から変換し、1〜50、既定 30 | なし | テストコードのとおり | timeline の limit は文字列から変換し、1〜50、既定 30 |  | なし | 実装時のテスト（NOUS-46） |  | TC-NOUS46_DEV-16 timeline の limit は文字列から変換し、1〜50、既定 30 |  |
| TC-NOUS46_DEV-17 | ThreadQuerySchema | 異常系 | 開発者テスト | thread の depth は 1〜10、既定 5 | なし | テストコードのとおり | thread の depth は 1〜10、既定 5 |  | なし | 実装時のテスト（NOUS-46） |  | TC-NOUS46_DEV-17 thread の depth は 1〜10、既定 5 |  |
| TC-NOUS46_DEV-18 | FollowsQuerySchema | 異常系 | 開発者テスト | follows の type は following・followers のどちらか | なし | テストコードのとおり | follows の type は following・followers のどちらか |  | なし | 実装時のテスト（NOUS-46） |  | TC-NOUS46_DEV-18 follows の type は following・followers のどちらか |  |
| TC-NOUS46_DEV-19 | InviteParamsSchema | 異常系 | 開発者テスト | 招待トークンは 43 字の Base64URL | なし | テストコードのとおり | 招待トークンは 43 字の Base64URL |  | なし | 実装時のテスト（NOUS-46） |  | TC-NOUS46_DEV-19 招待トークンは 43 字の Base64URL |  |
| TC-NOUS46_DEV-20 | AUDIT_OPERATIONS | 正常系 | 開発者テスト | 管理操作の種類は 18 種 | なし | テストコードのとおり | 管理操作の種類は 18 種 |  | なし | 実装時のテスト（NOUS-46） |  | TC-NOUS46_DEV-20 管理操作の種類は 18 種 |  |
| TC-NOUS46_DEV-21 | DEFAULT_SETTINGS / SETTINGS_RANGES | 正常系 | 開発者テスト | 実行設定の既定値は範囲の中にあり、SettingsSchema を通る | なし | テストコードのとおり | 実行設定の既定値は範囲の中にあり、SettingsSchema を通る |  | なし | 実装時のテスト（NOUS-46） |  | TC-NOUS46_DEV-21 実行設定の既定値は範囲の中にあり、SettingsSchema を通る |  |
| TC-NOUS46_DEV-22 | ERROR_CODES | 正常系 | 開発者テスト | エラーコードに重複がない | なし | テストコードのとおり | エラーコードに重複がない |  | なし | 実装時のテスト（NOUS-46） |  | TC-NOUS46_DEV-22 エラーコードに重複がない |  |
| TC-UT_SHR-001 | IdSchema | 異常系 | 境界値 | IdSchema は 26 字だけを受け付ける | なし | 25・26・27 字 | 26 字だけ受け付ける |  | なし | 一部 TC-NOUS46_DEV-16（"short" だけ） |  | TC-UT_SHR-001 IdSchema は 26 字だけを受け付ける | 字の種類は見ない（確認事項 1） |
| TC-UT_SHR-002 | TokenSchema | 異常系 | 境界値 | TokenSchema は 43 字の Base64URL だけを受け付ける | なし | - と _ を含む 43 字、44 字、= を含む 43 字 | - と _ を含む 43 字だけ受け付ける |  | なし | 一部 TC-NOUS46_DEV-19（42 字と + だけ） |  | TC-UT_SHR-002 TokenSchema は 43 字の Base64URL だけを受け付ける |  |
| TC-UT_SHR-003 | CursorSchema | 異常系 | 境界値 | CursorSchema は 1〜200 字の Base64URL だけを受け付ける | なし | 空・1 字・200 字・201 字・パディング付き | 1 字と 200 字だけ受け付ける |  | なし | なし |  | TC-UT_SHR-003 CursorSchema は 1〜200 字の Base64URL だけを受け付ける |  |
| TC-UT_SHR-004 | ObserverLimitSchema | 異常系 | 同値分割 | ObserverLimitSchema は下限 1 の整数だけを受け付け、文字列も数値にする | なし | "1"、1、"2.5"、"abc" | "1" と 1 は受け付け、小数と数字でない値は受け付けない |  | なし | 一部 TC-NOUS46_DEV-16（0・50・51 だけ） |  | TC-UT_SHR-004 ObserverLimitSchema は下限 1 の整数だけを受け付け、文字列も数値にする |  |
| TC-UT_SHR-005 | AdminLimitSchema | 正常系 | 境界値 | AdminLimitSchema は 1〜100 を受け付け、省略時は 50 にする | なし | 省略、"1"、"100" | 50、1、100 |  | なし | 一部 TC-NOUS46_DEV-13（既定値と 101 だけ） |  | TC-UT_SHR-005 AdminLimitSchema は 1〜100 を受け付け、省略時は 50 にする |  |
| TC-UT_SHR-006 | AdminLimitSchema | 異常系 | 境界値 | AdminLimitSchema は 0 を受け付けない | なし | "0" | 受け付けない |  | なし | なし |  | TC-UT_SHR-006 AdminLimitSchema は 0 を受け付けない |  |
| TC-UT_SHR-007 | UsageDateSchema | 異常系 | 境界値 | UsageDateSchema は実在する YYYY-MM-DD だけを受け付ける | なし | 2028-02-29、2026-02-29、2026-13-01、2026-1-01、2026/10/01 | 閏年の 2/29 だけ受け付ける | B6-T, B6-F | なし | 一部 TC-NOUS46_DEV-15（2026-02-30 だけ） |  | TC-UT_SHR-007 UsageDateSchema は実在する YYYY-MM-DD だけを受け付ける |  |
| TC-UT_SHR-008 | IsoDateTimeSchema | 異常系 | 同値分割 | IsoDateTimeSchema は時差のついた ISO 8601 の日時だけを受け付ける | なし | Z 付き、+09:00 付き、時差なし、日付だけ | 時差の付いた 2 つだけ受け付ける |  | なし | なし |  | TC-UT_SHR-008 IsoDateTimeSchema は時差のついた ISO 8601 の日時だけを受け付ける |  |
| TC-UT_SHR-009 | LoginRequestSchema | 正常系 | 境界値 | ログインのパスワードは前後の空白を除かずに字数を数える | なし | 前後に空白のある 12 字（中身は 10 字） | 受け付け、空白を除かずにそのまま返す |  | なし | 一部 TC-NOUS46_DEV-10（空白なしの字数だけ） |  | TC-UT_SHR-009 ログインのパスワードは前後の空白を除かずに字数を数える |  |
| TC-UT_SHR-010 | InvitationCreateRequestSchema | 正常系 | 境界値 | 招待の label は前後の空白を除いた値にし、1 字を受け付ける | なし | "  あ  " | 受け付け、label は "あ" |  | なし | 一部 TC-NOUS46_DEV-11（空白だけ・30 字・31 字） |  | TC-UT_SHR-010 招待の label は前後の空白を除いた値にし、1 字を受け付ける |  |
| TC-UT_SHR-011 | AuditLogQuerySchema | 異常系 | 同値分割 | 管理操作の履歴の絞り込みは 18 種の操作とカーソルを検証する | なし | operation = admin.login_failed、admin.unknown、cursor が 201 字 | admin.login_failed だけ受け付ける |  | なし | なし |  | TC-UT_SHR-011 管理操作の履歴の絞り込みは 18 種の操作とカーソルを検証する |  |
| TC-UT_SHR-012 | WorldResetRequestSchema | 異常系 | 境界値 | 世界のリセットの確認の名前は 1 字以上 | なし | confirmName = ""、"a" | "a" だけ受け付ける |  | なし | なし |  | TC-UT_SHR-012 世界のリセットの確認の名前は 1 字以上 |  |
| TC-UT_SHR-013 | GenerationListQuerySchema | 正常系 | 境界値 | 生成ログの期間は時刻として from ≦ to を比べる | なし | from = to、時差の違う同じ時刻、from だけ、to だけ、時差を入れると from が 1 秒後 | 最後だけ受け付けない | B1-T, B1-F, B2-T, B2-F | なし | 一部 TC-NOUS46_DEV-14（from < to と逆順だけ） |  | TC-UT_SHR-013 生成ログの期間は時刻として from ≦ to を比べる |  |
| TC-UT_SHR-014 | GenerationListQuerySchema | 異常系 | エラー処理 | 生成ログの期間が逆のとき、エラーは to の項目に付く | なし | from が to より 5 時間後 | issues は 1 件で、path は ["to"] | B1-T, B2-F | なし | なし |  | TC-UT_SHR-014 生成ログの期間が逆のとき、エラーは to の項目に付く |  |
| TC-UT_SHR-015 | PostSearchQuerySchema | 異常系 | 境界値 | 投稿の検索の q・agentId・visibility の境界 | なし | q が 1 字・50 字、agentId が 25 字、visibility = deleted | q の 2 つだけ受け付ける |  | なし | 一部 TC-NOUS46_DEV-13（q の 0 字・51 字だけ） |  | TC-UT_SHR-015 投稿の検索の q・agentId・visibility の境界 |  |
| TC-UT_SHR-016 | HideRequestSchema | 正常系 | 境界値 | 非表示の理由は空の文字列でもよい | なし | reason = "" | 受け付ける |  | なし | 一部 TC-NOUS46_DEV-12（省略と 200・201 字） |  | TC-UT_SHR-016 非表示の理由は空の文字列でもよい |  |
| TC-UT_SHR-017 | MetricsQuerySchema | 異常系 | 境界値 | 指標の期間は 1 日から受け付け、日付の形を検証する | なし | from = to（1 日）、to だけ、from が 2026/10/01 | 前の 2 つだけ受け付ける | B3-T, B3-F, B4-F, B5-F, B6-F | なし | 一部 TC-NOUS46_DEV-15（1 日ちょうどを見ていない） |  | TC-UT_SHR-017 指標の期間は 1 日から受け付け、日付の形を検証する |  |
| TC-UT_SHR-018 | MetricsQuerySchema | 異常系 | エラー処理 | 指標の期間が 90 日を超えるとき、エラーの文言に 90 日が入る | なし | from = 2026-07-24、to = 2026-10-22（91 日） | エラーの文言は「期間は 90 日以内にしてください」 | B3-F, B4-F, B5-T | なし | 一部 TC-NOUS46_DEV-15（失敗することだけ） |  | TC-UT_SHR-018 指標の期間が 90 日を超えるとき、エラーの文言に 90 日が入る |  |
| TC-UT_SHR-019 | AgentIdParams など 5 つのパスのパラメータ | 異常系 | 同値分割 | パスのパラメータは 26 字の ID だけを受け付ける | なし | 26 字の ID、25 字、省略 | 26 字だけ受け付ける |  | なし | なし |  | TC-UT_SHR-019 パスのパラメータは 26 字の ID だけを受け付ける |  |
| TC-UT_SHR-020 | AgentInputSchema（handle） | 正常系 | 同値分割 | handle は前後の空白を除いてから形を確かめる | なし | handle = "  minato_01  " | 受け付け、handle は "minato_01" |  | なし | 一部 TC-NOUS46_DEV-03（displayName の trim だけ） |  | TC-UT_SHR-020 handle は前後の空白を除いてから形を確かめる |  |
| TC-UT_SHR-021 | AgentInputSchema（handle） | 異常系 | 同値分割 | handle に日本語を含めば受け付けない | なし | handle = "みなと_01" | 受け付けない |  | なし | 一部 TC-NOUS46_DEV-02（- だけ） |  | TC-UT_SHR-021 handle に日本語を含めば受け付けない |  |
| TC-UT_SHR-022 | AgentInputSchema（displayName） | 異常系 | 境界値 | displayName は 1〜30 字 | なし | displayName が 0・1・30・31 字 | 1 字と 30 字だけ受け付ける |  | なし | なし |  | TC-UT_SHR-022 displayName は 1〜30 字 |  |
| TC-UT_SHR-023 | AgentInputSchema（bio） | 正常系 | 境界値 | bio が空白だけなら空の文字列にする | なし | bio = 空白 3 字 | 受け付け、bio は "" | B7-F | なし | なし |  | TC-UT_SHR-023 bio が空白だけなら空の文字列にする |  |
| TC-UT_SHR-024 | AgentInputSchema（activityLevel） | 異常系 | 同値分割 | activityLevel は文字列の数字を受け付けない（JSON の本文は変換しない） | なし | activityLevel = "3"（文字列） | 受け付けない |  | なし | 一部 TC-NOUS46_DEV-05（数値の範囲と小数だけ） |  | TC-UT_SHR-024 activityLevel は文字列の数字を受け付けない（JSON の本文は変換しない） |  |
| TC-UT_SHR-025 | AgentInputSchema | 異常系 | 同値分割 | 必須の属性（valuesText）がなければ受け付けない | なし | valuesText を省いた本文 | 受け付けない |  | なし | なし |  | TC-UT_SHR-025 必須の属性（valuesText）がなければ受け付けない |  |
| TC-UT_SHR-026 | AgentListQuerySchema | 異常系 | 同値分割 | エージェントの一覧の state は active・stopped だけ | なし | 省略、state = stopped、deleted | 前の 2 つだけ受け付ける |  | なし | なし |  | TC-UT_SHR-026 エージェントの一覧の state は active・stopped だけ |  |
| TC-UT_SHR-027 | SettingsSchema | 異常系 | 境界値 | 数値の項目は下限・上限を受け付け、その外側を受け付けない | なし | 数値の 9 項目それぞれの min-1・min・max・max+1（範囲は BE 詳細設計 world 2章） | min と max だけ受け付ける |  | なし | 一部 TC-NOUS46_DEV-08（cycleMinutes の 4 点と 2 項目の上限の外だけ） |  | TC-UT_SHR-027 数値の項目は下限・上限を受け付け、その外側を受け付けない |  |
| TC-UT_SHR-028 | SettingsSchema | 異常系 | 同値分割 | 数値の項目は整数の数値だけを受け付ける | なし | cycleMinutes = 20.5、"20" | どちらも受け付けない |  | なし | なし |  | TC-UT_SHR-028 数値の項目は整数の数値だけを受け付ける |  |
| TC-UT_SHR-029 | SettingsSchema（promptVersion） | 異常系 | 境界値 | promptVersion は 1〜20 字 | なし | promptVersion が 0・20・21 字 | 20 字だけ受け付ける |  | なし | なし |  | TC-UT_SHR-029 promptVersion は 1〜20 字 | prompts/ にある版かどうかはサーバーで確かめる（NOUS-97 の観点） |
| TC-UT_SHR-030 | AUDIT_OPERATIONS | 正常系 | 同値分割 | 管理操作の種類が基本設計書 7章の 18 種と同じ並びである | なし | AUDIT_OPERATIONS | 基本設計書 概要 7章（admin_audit_logs.operation）の 18 種と同じ並び |  | なし | 一部 TC-NOUS46_DEV-20（件数だけ） |  | TC-UT_SHR-030 管理操作の種類が基本設計書 7章の 18 種と同じ並びである |  |
| TC-UT_SHR-031 | DEFAULT_SETTINGS | 正常系 | 同値分割 | 実行設定の既定値が DB 物理設計書（world_settings の DEFAULT）と同じである | なし | DEFAULT_SETTINGS | DB 物理設計書の world_settings の DEFAULT（20・100・12・1200・1500・300・9500・480・1・gemma・v1）と同じ |  | なし | 一部 TC-NOUS46_DEV-21（範囲の中にあることだけ） |  | TC-UT_SHR-031 実行設定の既定値が DB 物理設計書（world_settings の DEFAULT）と同じである |  |
| TC-UT_SHR-032 | OBSERVER_PORT / ADMIN_PORT / TOKEN_LENGTH | 正常系 | 同値分割 | 既定のポートは観察 8080・管理 8081、トークンは 43 字 | なし | 定数 | 8080・8081・43（基本設計書 7章・admin_auth） |  | なし | なし |  | TC-UT_SHR-032 既定のポートは観察 8080・管理 8081、トークンは 43 字 |  |

## 3. 確認事項・バグの疑い

- 確認事項 1：IdSchema は長さ 26 字だけを見て、ULID の字（Crockford の Base32）かは確かめない（サーバーの isUlid とは違う）。形の違う 26 字は検索で見つからず 404 になるだけで害はないが、設計書の「ULID（26 字）」をどこまで検証するかは決まっていない。
- 確認事項 2：limit が空の文字列（?limit=）のとき、z.coerce で 0 になり 400 VALIDATION_ERROR になる（省略時の既定値にはならない）。画面は limit を空で送らないので、今は実害なし。
- 共有の定数の列挙値・範囲と schema.sql の CHECK との一致は、DB の観点（NOUS-94）で確かめる。@nous/shared の ERROR_CODES とサーバーのエラーコードの突き合わせは lib の観点表（TC-UT_LIB-015、疑い 1）で扱う。
- types/（型だけで実行されるコードがない）は単体テストの対象にしない。型の誤りは pnpm typecheck で見る。
