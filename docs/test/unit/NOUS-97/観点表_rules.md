# 単体テスト観点表：世界の状態遷移の表・上限の判定・世界内時間（world/stateMachine.ts・limits.ts・worldTime.ts）

| 項目 | 内容 |
|---|---|
| 関連チケット | NOUS-97 |
| 作成者 | Mark Zuckerberg（開発担当） |
| 作成日 | 2026-10-23 |
| 対象 | apps/server/src/world/stateMachine.ts, apps/server/src/world/limits.ts, apps/server/src/world/worldTime.ts |
| 言語 / フレームワーク | TypeScript / Vitest 2.1.9（environment: node） |
| テストファイル | apps/server/src/world/rules.test.ts（実装時、NOUS-57）, apps/server/src/world/stateMachine.ut.test.ts（単体テストで追加）, apps/server/src/world/limits.ut.test.ts（単体テストで追加）, apps/server/src/world/worldTime.ut.test.ts（単体テストで追加） |
| 外部依存 | DB（settleWorldTime のみ。一時 DB を使う）, 時刻（引数の now。Date を直接渡す） |
| 入力にした設計書 | 基本設計書（概要）6章「状態の遷移」世界の状態（遷移表 12 行）, BE 詳細設計 world 4章 canTransition・getWorldTimeSec・settleWorldTime・isWithinLimits・limitReason・beat・recoverOnStartup, BE 詳細設計 world 3章 updateWorldState |

このファイルは `docs/test/unit/_build/build_matrix.py` で JSON から作る。直すときは JSON を直して作り直す。

## 1. 分岐の一覧

| ID | 条件 | 場所 |
|---|---|---|
| B1 | WORLD_TRANSITIONS に from→to の組がある | stateMachine.ts:28 |
| B2 | isWithinLimits：neurons < daily_neurons_limit | limits.ts:20 |
| B3 | isWithinLimits：runs < daily_runs_limit（&& の右辺） | limits.ts:20 |
| B4 | limitReason：neurons >= daily_neurons_limit | limits.ts:25 |
| B5 | limitReason：runs >= daily_runs_limit | limits.ts:26 |
| B6 | getWorldTimeSec：state !== 'running' \|\| running_since === null | worldTime.ts:25 |
| B7 | elapsedSec：差が負なら Math.max で 0 | worldTime.ts:20-21 |
| B8 | settleWorldTime：UPDATE が 0 行（読んだときと state が違う） | worldTime.ts:48 |
| B9 | heartbeatPatch：state !== 'running' \|\| running_since === null | worldTime.ts:64 |
| B10 | heartbeatPatch：heartbeat_at ?? running_since（heartbeat_at が null） | worldTime.ts:66 |
| B11 | heartbeatPatch：生存時刻からの秒 > 180 | worldTime.ts:67 |
| B12 | startupPatch：state !== 'running' \|\| running_since === null | worldTime.ts:82 |
| B13 | startupPatch：heartbeat_at ?? running_since（heartbeat_at が null） | worldTime.ts:84 |

## 2. ケースの一覧（28 件。うち新しく足したもの 14 件）

| ID | 対象 | 分類 | 技法 | 観点 | 前提 | 入力 | 期待結果 | 分岐 | モック | 既存テストとの対応 | バグの疑い | テスト名 | 備考 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| TC-NOUS57_DEV-01 | canTransition | 正常系 | 開発者テスト | 遷移の表にある 15 組（12 行を遷移元ごとに展開）はすべて許可する | なし | rules.test.ts の allowed の 15 組 | すべて true | B1-T | なし | 実装時のテスト（NOUS-57） |  | TC-NOUS57_DEV-01 遷移の表にある組はすべて許可する | allowed に preparing→limit_stopped が入っていない（疑い 1） |
| TC-NOUS57_DEV-02 | canTransition | 異常系 | 開発者テスト | 6 状態×6 状態の全組のうち、表にない組はすべて拒否する | なし | WORLD_STATES の直積 36 組 | 表にある組だけ true、ほかは false | B1-T, B1-F | なし | 実装時のテスト（NOUS-57） |  | TC-NOUS57_DEV-02 遷移の表にない組はすべて拒否する | preparing→limit_stopped を false と期待している（疑い 1） |
| TC-NOUS57_DEV-03 | canTransition | 異常系 | 開発者テスト | preparing と running からは archived にできない | なし | (preparing, archived)、(running, archived) | false | B1-F | なし | 実装時のテスト（NOUS-57） |  | TC-NOUS57_DEV-03 preparing と running からは archived にできない（リセット不可） |  |
| TC-NOUS57_DEV-04 | canTransition | 異常系 | 開発者テスト | archived からはどこへも遷移しない | なし | (archived, 各状態) | false | B1-F | なし | 実装時のテスト（NOUS-57） |  | TC-NOUS57_DEV-04 archived からはどこへも遷移しない |  |
| TC-NOUS57_DEV-05 | isWithinLimits / limitReason | 正常系 | 開発者テスト | Neurons・実行回数とも上限未満なら上限の中 | 上限 9,500・480 | neurons 9,499.9、runs 479 | isWithinLimits true、limitReason null | B2-T, B3-T, B4-F, B5-F | なし | 実装時のテスト（NOUS-57） |  | TC-NOUS57_DEV-05 両方とも上限未満なら上限の中 |  |
| TC-NOUS57_DEV-06 | isWithinLimits / limitReason | 異常系 | 開発者テスト | Neurons が上限ちょうどなら neurons_limit | 上限 9,500・480 | neurons 9,500、runs 0 | false、neurons_limit | B2-F, B4-T | なし | 実装時のテスト（NOUS-57） |  | TC-NOUS57_DEV-06 Neurons が 9,500 以上なら neurons_limit |  |
| TC-NOUS57_DEV-07 | isWithinLimits / limitReason | 異常系 | 開発者テスト | 実行回数が上限ちょうどなら runs_limit | 上限 9,500・480 | neurons 0、runs 480 | false、runs_limit | B2-T, B3-F, B4-F, B5-T | なし | 実装時のテスト（NOUS-57） |  | TC-NOUS57_DEV-07 実行回数が 480 以上なら runs_limit |  |
| TC-NOUS57_DEV-08 | limitReason | 異常系 | 開発者テスト | 両方とも上限を超えていれば Neurons を先に見る | 上限 9,500・480 | neurons 10,000、runs 500 | neurons_limit | B4-T | なし | 実装時のテスト（NOUS-57） |  | TC-NOUS57_DEV-08 両方とも上限なら neurons_limit を先に返す |  |
| TC-NOUS57_DEV-09 | getWorldTimeSec | 正常系 | 開発者テスト | running なら確定分に running_since からの秒（切り捨て）を足す | 確定分 100、running_since 00:00:00 | now 00:01:00.999 | 160 | B6-F, B7-F | なし | 実装時のテスト（NOUS-57） |  | TC-NOUS57_DEV-09 running なら確定分に running_since からの秒（切り捨て）を足す |  |
| TC-NOUS57_DEV-10 | getWorldTimeSec | 正常系 | 開発者テスト | running 以外は確定分だけ | paused、確定分 100 | now 05:00 | 100 | B6-T | なし | 実装時のテスト（NOUS-57） |  | TC-NOUS57_DEV-10 running 以外は確定分だけ |  |
| TC-NOUS57_DEV-11 | heartbeatPatch | 正常系 | 開発者テスト | 生存時刻が 180 秒を超えて古ければ、最後の生存時刻までを足して running_since を now にする | running、確定分 100、running_since 00:00、heartbeat_at 00:10 | now 02:00 | world_elapsed_sec 700、running_since と heartbeat_at は now | B9-F, B10-F, B11-T | なし | 実装時のテスト（NOUS-57） |  | TC-NOUS57_DEV-11 生存時刻が 180 秒を超えて古ければ、最後の生存時刻までを足して running_since を now にする |  |
| TC-NOUS57_DEV-12 | heartbeatPatch | 正常系 | 開発者テスト | 生存時刻が 180 秒以内なら heartbeat_at だけを更新する | running、heartbeat_at 00:10 | now 00:13 | 確定分と running_since はそのまま、heartbeat_at は now | B9-F, B10-F, B11-F | なし | 実装時のテスト（NOUS-57） |  | TC-NOUS57_DEV-12 生存時刻が 180 秒以内なら heartbeat_at だけを更新する |  |
| TC-NOUS57_DEV-13 | startupPatch | 正常系 | 開発者テスト | 起動時は最後の生存時刻までを足し、running_since と heartbeat_at を now にする | running、running_since 00:00:00、heartbeat_at 00:00:30 | now 翌日 00:00 | world_elapsed_sec 30、running_since と heartbeat_at は now | B12-F, B13-F | なし | 実装時のテスト（NOUS-57） |  | TC-NOUS57_DEV-13 起動時の補正は、最後の生存時刻までを足して running_since と heartbeat_at を now にする |  |
| TC-NOUS57_DEV-14 | heartbeatPatch / startupPatch | 正常系 | 開発者テスト | running でなければ補正しない | paused | 任意の now | どちらも null | B9-T, B12-T | なし | 実装時のテスト（NOUS-57） |  | TC-NOUS57_DEV-14 running でなければ補正しない |  |
| TC-UT_WLD-001 | canTransition | 正常系 | 状態遷移 | 概要 6章の遷移表にある preparing → limit_stopped を許可する | なし | from preparing、to limit_stopped | true | B1-T | なし | 一部 TC-NOUS57_DEV-01（この組は allowed に入っていない） | 実装は false を返す（WORLD_TRANSITIONS にこの組がない）。疑い 1 | TC-UT_WLD-001 概要 6章の遷移表にある preparing → limit_stopped を許可する | 概要 v3.10（NOUS-78）で追加された行 |
| TC-UT_WLD-002 | canTransition | 異常系 | 同値分割 | 同じ状態への遷移（自己遷移）はすべて拒否する | なし | from・to とも WORLD_STATES の 6 状態のそれぞれ | false | B1-F | なし | 一部 TC-NOUS57_DEV-02（直積の中に含むが、自己遷移として独立には見ていない） |  | TC-UT_WLD-002 同じ状態への遷移は拒否する |  |
| TC-UT_WLD-003 | isWithinLimits / limitReason | 正常系 | 境界値 | 上限を下限の 1 にしたとき、利用量 0 は上限の中、1 は上限に達している | 上限 Neurons 1・実行回数 1（SETTINGS_RANGES の下限） | (0,0)、(1,0)、(0,1) | (0,0) は true と null、(1,0) は neurons_limit、(0,1) は runs_limit | B2-T, B3-T, B4-T, B4-F, B5-T, B5-F | なし | なし（DEV は既定の上限 9,500・480 だけ） |  | TC-UT_WLD-003 上限を下限の 1 にしたとき、利用量 0 は上限の中、1 は上限に達している |  |
| TC-UT_WLD-004 | isWithinLimits / limitReason | 異常系 | 境界値 | 上限を 1 超えた値も上限の外になる | 上限 9,500・480 | (9,501, 0)、(0, 481) | false と neurons_limit、false と runs_limit | B2-F, B2-T, B3-F, B4-T, B5-T | なし | 一部 TC-NOUS57_DEV-06・07（上限ちょうどまで） |  | TC-UT_WLD-004 上限を超えた値（Neurons 9,501・実行回数 481）も上限の外になる |  |
| TC-UT_WLD-005 | getWorldTimeSec | 異常系 | 境界値 | running で now が running_since より前なら、確定分だけを返す（負の秒を足さない） | running、確定分 100、running_since 2026-10-22T00:00:00Z | now 2026-10-21T23:59:00Z | 100 | B6-F, B7-T | なし | なし（DEV は now が後のときだけ） |  | TC-UT_WLD-005 running で now が running_since より前なら、確定分だけを返す（負にしない） |  |
| TC-UT_WLD-006 | getWorldTimeSec | 異常系 | 分岐網羅 | running でも running_since が null なら確定分だけを返す | running、確定分 100、running_since null | now 01:00 | 100 | B6-T | なし | なし（DEV-10 は paused で B6 の左辺だけ） |  | TC-UT_WLD-006 running でも running_since が null なら、確定分だけを返す | worlds の CHECK では起きない組だが、関数の分岐として確かめる |
| TC-UT_WLD-007 | getWorldTimeSec | 正常系 | 境界値 | running_since から 999 ミリ秒は 0 秒、1,000 ミリ秒は 1 秒と数える（切り捨て） | running、確定分 0、running_since 00:00:00.000 | now 00:00:00.999、00:00:01.000 | 0、1 | B6-F, B7-F | なし | 一部 TC-NOUS57_DEV-09（60.999 秒の切り捨てだけ） |  | TC-UT_WLD-007 running_since から 999 ミリ秒は 0 秒、1,000 ミリ秒は 1 秒と数える |  |
| TC-UT_WLD-008 | heartbeatPatch | 正常系 | 境界値 | 生存時刻からちょうど 180 秒なら補正しない（180 秒を「超えて」古いときだけ補正） | running、確定分 100、heartbeat_at 00:10:00 | now 00:13:00 | 確定分 100 と running_since はそのまま、heartbeat_at は now | B9-F, B10-F, B11-F | なし | 一部 TC-NOUS57_DEV-12（ちょうど 180 秒の値で見ている。境界として独立に置く） |  | TC-UT_WLD-008 生存時刻からちょうど 180 秒なら補正せず、heartbeat_at だけを now にする |  |
| TC-UT_WLD-009 | heartbeatPatch | 正常系 | 境界値 | 生存時刻から 181 秒なら補正し、最後の生存時刻までを足して running_since を now にする | running、確定分 100、running_since 00:00、heartbeat_at 00:10:00 | now 00:13:01 | world_elapsed_sec 700、running_since と heartbeat_at は now | B9-F, B10-F, B11-T | なし | 一部 TC-NOUS57_DEV-11（1 時間 50 分空いたときだけ） |  | TC-UT_WLD-009 生存時刻から 181 秒なら補正し、最後の生存時刻までを足して running_since を now にする |  |
| TC-UT_WLD-010 | heartbeatPatch | 正常系 | 分岐網羅 | heartbeat_at が null なら running_since を最後の生存時刻として補正する | running、確定分 100、running_since 00:00、heartbeat_at null | now 01:00 | world_elapsed_sec 100（足す秒は 0）、running_since と heartbeat_at は now | B9-F, B10-T, B11-T | なし | なし（DEV は heartbeat_at が入っているときだけ） |  | TC-UT_WLD-010 heartbeat_at が null なら running_since を最後の生存時刻として補正する |  |
| TC-UT_WLD-011 | startupPatch | 正常系 | 分岐網羅 | 起動時の補正で heartbeat_at が null なら、確定分は変えずに running_since と heartbeat_at を now にする | running、確定分 42、heartbeat_at null | now 2026-10-23T00:00Z | world_elapsed_sec 42、running_since と heartbeat_at は now | B12-F, B13-T | なし | なし（DEV-13 は heartbeat_at があるとき） |  | TC-UT_WLD-011 起動時の補正で heartbeat_at が null なら、確定分は変えずに running_since と heartbeat_at を now にする |  |
| TC-UT_WLD-012 | startupPatch | 異常系 | 境界値 | heartbeat_at が running_since より前（不整合）なら、足す秒は 0 にする | running、確定分 42、running_since 2026-10-22T00:00Z、heartbeat_at 2026-10-21T23:00Z | now 2026-10-23T00:00Z | world_elapsed_sec 42 | B12-F, B13-F, B7-T | なし | なし |  | TC-UT_WLD-012 起動時の補正で heartbeat_at が running_since より前なら、足す秒は 0 にする |  |
| TC-UT_WLD-013 | settleWorldTime | 正常系 | 同値分割 | running の世界の世界内時間を確定し、遷移先の state と同じ UPDATE で書いて確定した秒を返す | worlds に running の世界（確定分 100、running_since 00:00:00） | now 00:01:30、next { state: paused, stop_reason: manual_pause } | 戻り値 190。worlds は paused・manual_pause・world_elapsed_sec 190・running_since null | B6-F, B8-F | 一時 DB（createTestDb） | なし（DEV は worldService 経由でだけ見ている） |  | TC-UT_WLD-013 running の世界の世界内時間を確定し、遷移先の state と同じ UPDATE で書いて確定した秒を返す |  |
| TC-UT_WLD-014 | settleWorldTime | 異常系 | 状態遷移 | 読んだときと state が違えば書かずに null を返す（楽観の確認） | worlds に running の世界 | 読んだ値の state を paused に書き換えた world、next { state: emergency_stopped } | 戻り値 null。worlds は running・確定分 100・running_since のまま | B8-T | 一時 DB（createTestDb） | なし（並行の更新は DEV にない） |  | TC-UT_WLD-014 読んだときと state が違えば書かずに null を返す（楽観の確認） |  |

## 3. 確認事項・バグの疑い

- 疑い 1：基本設計書（概要）v3.10（NOUS-78）で遷移表に preparing → limit_stopped を足したが、stateMachine.ts の WORLD_TRANSITIONS には入っておらず、canTransition('preparing', 'limit_stopped') が false を返す。world.md 4章は canTransition を「基本設計書 6章の遷移の表を定数で持つ」としている。startWorld は canTransition を使わずに準備中かどうかで判定するため、今の動作への影響はない。TC-UT_WLD-001 は仕様どおり true を期待するので、実施では NG になる見込み。あわせて TC-NOUS57_DEV-01・02 の期待（allowed の一覧）も表と合わない
- 確認事項 1：遷移表の「running・paused・limit_stopped → emergency_stopped」と「preparing 以外 → archived」は複数の遷移元をまとめた行のため、観点表では遷移元ごとの組（15 組）で数えた。状態ごとの操作（start・pause・resume・emergency-stop・reset）からの遷移は 観点表_worldService.json で見る
