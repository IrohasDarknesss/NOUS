# 単体テスト観点表：日次の処理 B02・B06・B07・B08（dayRollover・backup・startupRecovery・heartbeat）

| 項目 | 内容 |
|---|---|
| 関連チケット | NOUS-98 |
| 作成者 | Mark Zuckerberg（開発担当） |
| 作成日 | 2026-10-23 |
| 対象 | apps/server/src/scheduler/dayRollover.ts, apps/server/src/scheduler/backup.ts, apps/server/src/scheduler/startupRecovery.ts, apps/server/src/scheduler/heartbeat.ts |
| 言語 / フレームワーク | TypeScript / Vitest 2.1.9（environment: node） |
| テストファイル | apps/server/src/scheduler/{dayRollover,backup,startupRecovery,heartbeat}.test.ts（実装時、NOUS-60）, apps/server/src/scheduler/{dayRollover,backup,startupRecovery,heartbeat}.ut.test.ts（単体テストで追加） |
| 外部依存 | DB（一時 DB）, 時計（FakeClock）, ファイル（一時ディレクトリへの VACUUM INTO）, scheduler.wake（vi.fn）, logger（captureLogger） |
| 入力にした設計書 | BE 詳細設計 world 1章（起動のシーケンス）・4章（IPO）・5章（B01・B02・B06・B07・B08）・6章（例外・トランザクション）, 基本設計書 概要 10章（バックアップ） |

このファイルは `docs/test/unit/_build/build_matrix.py` で JSON から作る。直すときは JSON を直して作り直す。

## 1. 分岐の一覧

| ID | 条件 | 場所 |
|---|---|---|
| B1 | dayRollover.rolloverDay：現在の世界がない | dayRollover.ts:40 |
| B2 | dayRollover.rolloverDay：世界が limit_stopped でない | dayRollover.ts:46 |
| B3 | dayRollover.rolloverDay：楽観の確認の UPDATE が 1 行以上（changes > 0） | dayRollover.ts:61 |
| B4 | dayRollover.rolloverDay：resumed なら wake | dayRollover.ts:64 |
| B5 | dayRollover.rolloverDay：runBackup の失敗（catch） | dayRollover.ts:71 |
| B6 | dayRollover.scheduleDayRollover：rolloverDay の例外（catch） | dayRollover.ts:86 |
| B7 | backup.runBackup：同じ名前のファイルがある | backup.ts:48 |
| B8 | backup.runBackup：名前が aisns-YYYYMMDD-HHMM.db の形 | backup.ts:54 |
| B9 | backup.runBackup：8 件目以降の削除（ループ 0 回／1 回以上） | backup.ts:57 |
| B10 | backup.runBackup：logger がある | backup.ts:61 |
| B11 | backup.runBackup：失敗（catch → BackupError） | backup.ts:63 |
| B12 | startupRecovery.recoverOnStartup：現在の世界がある | startupRecovery.ts:47 |
| B13 | startupRecovery.recoverOnStartup：startupPatch が null でない（running） | startupRecovery.ts:49 |
| B14 | startupRecovery.recoverOnStartup：logger がある | startupRecovery.ts:68 |
| B15 | heartbeat.beat：現在の世界がない | heartbeat.ts:35 |
| B16 | heartbeat.beat：heartbeatPatch が null（running でない） | heartbeat.ts:40 |
| B17 | heartbeat.beat：UPDATE が 0 行 | heartbeat.ts:50 |
| B18 | heartbeat.beat：running_since が変わった（スリープの補正） | heartbeat.ts:55 |
| B19 | heartbeat.beat：next_cycle_at があり now >= next_cycle_at | heartbeat.ts:64 |
| B20 | heartbeat.scheduleHeartbeat：beat の例外（catch） | heartbeat.ts:79 |

## 2. ケースの一覧（38 件。うち新しく足したもの 20 件）

| ID | 対象 | 分類 | 技法 | 観点 | 前提 | 入力 | 期待結果 | 分岐 | モック | 既存テストとの対応 | バグの疑い | テスト名 | 備考 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| TC-NOUS60_DEV-01 | backupFileName | 正常系 | 開発者テスト | UTC の時刻から aisns-YYYYMMDD-HHMM.db を返す | なし | 2026-10-22T00:00:00.000Z、2026-01-05T09:07:59.999Z | aisns-20261022-0000.db、aisns-20260105-0907.db |  | なし | 実装時のテスト（NOUS-60） |  | TC-NOUS60_DEV-01 backupFileName は UTC の時刻から aisns-YYYYMMDD-HHMM.db の形式を返す |  |
| TC-NOUS60_DEV-02 | runBackup | 正常系 | 開発者テスト | バックアップのファイルが作られ、同じ分の再実行でも上書きできる | 一時 DB（createTestDb）、初回の世界 | 存在しないサブディレクトリに 2 回 | 同じパス。複製に worlds の行がある | B7-T, B7-F, B10-F, B11-F | 一時 DB（createTestDb）、一時ディレクトリ | 実装時のテスト（NOUS-60） |  | TC-NOUS60_DEV-02 runBackup でバックアップファイルが作られ、同じ分の再実行でも上書きできる |  |
| TC-NOUS60_DEV-03 | runBackup | 正常系 | 開発者テスト | 8 件以上あると古いものから消え、新しい 7 件だけが残る | 一時 DB（createTestDb）、README.txt を置く | 9 日分の runBackup | 新しい 7 件と README.txt が残る | B8-T, B9-T | 一時 DB（createTestDb）、一時ディレクトリ | 実装時のテスト（NOUS-60） |  | TC-NOUS60_DEV-03 8 件以上あると古いものから消えて新しい 7 件だけが残る |  |
| TC-NOUS60_DEV-04 | runBackup | 異常系 | 開発者テスト | 失敗したときは原因を cause に持つ BackupError を投げる | DB を閉じる | runBackup | BackupError、cause あり | B11-T | 一時 DB（createTestDb） | 実装時のテスト（NOUS-60） |  | TC-NOUS60_DEV-04 失敗したときは原因を cause に持つ BackupError を投げる |  |
| TC-NOUS60_DEV-05 | rolloverDay | 正常系 | 開発者テスト | 00:00 UTC で daily_usage と現在の世界の daily_metrics の新しい日の行ができる | 一時 DB（createTestDb）、初回の世界 | rolloverDay(00:00) | daily_usage・daily_metrics の行ができる | B1-F, B5-F | FakeClock 2026-10-22T00:00:00.000Z、scheduler.wake を vi.fn | 実装時のテスト（NOUS-60） |  | TC-NOUS60_DEV-05 00:00 UTC で daily_usage と現在の世界の daily_metrics の新しい日の行ができる |  |
| TC-NOUS60_DEV-06 | rolloverDay | 正常系 | 開発者テスト | 同じ利用日で 2 回呼んでも重複せず、既存の値も壊さない | 一時 DB（createTestDb）、初回の世界 | rolloverDay を 2 回 | 行は 1 つで値はそのまま |  | FakeClock 2026-10-22T00:00:00.000Z、scheduler.wake を vi.fn | 実装時のテスト（NOUS-60） |  | TC-NOUS60_DEV-06 同じ利用日で 2 回呼んでも重複せず既存の値も壊さない |  |
| TC-NOUS60_DEV-07 | rolloverDay | 正常系 | 開発者テスト | limit_stopped の世界が running に戻り scheduler.wake が呼ばれる | limit_stopped の世界 | rolloverDay(00:00) | running、stop_reason NULL、running_since・heartbeat_at が now、wake 1 回 | B2-F, B3-T, B4-T | FakeClock 2026-10-22T00:00:00.000Z、scheduler.wake を vi.fn | 実装時のテスト（NOUS-60） |  | TC-NOUS60_DEV-07 limit_stopped の世界が running に戻り scheduler.wake が呼ばれる |  |
| TC-NOUS60_DEV-08 | rolloverDay | 正常系 | 開発者テスト | running・paused・emergency_stopped の世界は状態が変わらず wake も呼ばれない | 各状態の世界 | rolloverDay(00:00) | 状態はそのまま、wake は呼ばれない | B2-T, B4-F | FakeClock 2026-10-22T00:00:00.000Z、scheduler.wake を vi.fn | 実装時のテスト（NOUS-60） |  | TC-NOUS60_DEV-08 running・paused・emergency_stopped の世界は状態が変わらず wake も呼ばれない |  |
| TC-NOUS60_DEV-09 | rolloverDay | 異常系 | 開発者テスト | バックアップが失敗しても例外にならず backupPath が null になり、エラーが記録される | バックアップの置き場をファイルにする | rolloverDay(00:00) | backupPath null、daily_usage はできる、error が記録される | B5-T | FakeClock 2026-10-22T00:00:00.000Z、scheduler.wake を vi.fn、captureLogger | 実装時のテスト（NOUS-60） |  | TC-NOUS60_DEV-09 バックアップが失敗しても例外にならず backupPath が null になりエラーが記録される |  |
| TC-NOUS60_DEV-10 | scheduleDayRollover | 正常系 | 開発者テスト | FakeClock を 23:59 から 00:00 UTC を越えて進めると走り、翌日の 00:00 でも走る。解除の後は走らない | limit_stopped の世界、時計 2026-10-21T23:59:00.000Z | 1 分進める → 24 時間進める → 解除 → 24 時間進める | 2026-10-22・23 の行ができ、解除の後は増えない | B6-F | FakeClock 2026-10-21T23:59:00.000Z、scheduler.wake を vi.fn | 実装時のテスト（NOUS-60） |  | TC-NOUS60_DEV-10 scheduleDayRollover で FakeClock を 23:59 から 00:00 UTC を越えて進めると rolloverDay が走り、翌日の 00:00 でも再び走る |  |
| TC-NOUS60_DEV-11 | recoverOnStartup | 正常系 | 開発者テスト | running の generation_events が interrupted になり、他の状態は変わらない | running・succeeded などの生成イベント | recoverOnStartup(05:00) | running だけ interrupted | B14-T | FakeClock 2026-10-22T05:00:00.000Z | 実装時のテスト（NOUS-60） |  | TC-NOUS60_DEV-11 running の generation_events が interrupted になり、他の状態は変わらない |  |
| TC-NOUS60_DEV-12 | recoverOnStartup | 正常系 | 開発者テスト | running の世界の世界内時間が heartbeat_at までで補正され、running_since と heartbeat_at が now になる | running の世界（elapsed 120、00:00 から 00:10 まで生存） | recoverOnStartup(05:00) | world_elapsed_sec 720、running_since・heartbeat_at が 05:00 | B12-T, B13-T | FakeClock 2026-10-22T05:00:00.000Z | 実装時のテスト（NOUS-60） |  | TC-NOUS60_DEV-12 running の世界の世界内時間が heartbeat_at までで補正され、running_since と heartbeat_at が now になる |  |
| TC-NOUS60_DEV-13 | recoverOnStartup | 正常系 | 開発者テスト | 期限切れのセッションだけが削除される | 有効なセッションとアイドル期限切れのセッション | recoverOnStartup(05:00) | deletedSessions 1、有効なものが残る |  | FakeClock 2026-10-22T05:00:00.000Z | 実装時のテスト（NOUS-60） |  | TC-NOUS60_DEV-13 期限切れのセッションだけが削除される |  |
| TC-NOUS60_DEV-14 | beat | 正常系 | 開発者テスト | 世界が running でなければ何もしない | preparing・paused の世界 | beat | updated・corrected・woke がすべて false、wake は呼ばれない | B15-F, B16-T | FakeClock 2026-10-22T00:00:00.000Z、scheduler.wake を vi.fn | 実装時のテスト（NOUS-60） |  | TC-NOUS60_DEV-14 世界が running でなければ何もしない |  |
| TC-NOUS60_DEV-15 | beat | 正常系 | 開発者テスト | 前回の heartbeat_at から 180 秒以内なら heartbeat_at だけを更新する | running の世界 | beat | heartbeat_at だけ now | B15-F, B16-F, B17-F, B18-F | FakeClock 2026-10-22T00:00:00.000Z、scheduler.wake を vi.fn | 実装時のテスト（NOUS-60） |  | TC-NOUS60_DEV-15 前回の heartbeat_at から 180 秒以内なら heartbeat_at だけを更新する |  |
| TC-NOUS60_DEV-16 | beat | 正常系 | 開発者テスト | 180 秒を超えて古ければ世界内時間を補正し、running_since を now にする | running の世界 | beat | corrected true、world_elapsed_sec が補正される | B18-T | FakeClock 2026-10-22T00:00:00.000Z、scheduler.wake を vi.fn | 実装時のテスト（NOUS-60） |  | TC-NOUS60_DEV-16 前回の heartbeat_at から 180 秒を超えて古ければ世界内時間を補正し running_since を now にする |  |
| TC-NOUS60_DEV-17 | beat | 正常系 | 開発者テスト | next_cycle_at を過ぎていれば scheduler.wake を呼ぶ | running の世界、next_cycle_at を過去に | beat | woke true、wake 1 回 | B19-T | FakeClock 2026-10-22T00:00:00.000Z、scheduler.wake を vi.fn | 実装時のテスト（NOUS-60） |  | TC-NOUS60_DEV-17 next_cycle_at を過ぎていれば scheduler.wake を呼ぶ |  |
| TC-NOUS60_DEV-18 | scheduleHeartbeat | 正常系 | 開発者テスト | FakeClock を 60 秒進めるごとに beat が走る | running の世界 | 60 秒ずつ進める | heartbeat_at が 60 秒ごとに更新される | B20-F | FakeClock 2026-10-22T00:00:00.000Z、scheduler.wake を vi.fn | 実装時のテスト（NOUS-60） |  | TC-NOUS60_DEV-18 scheduleHeartbeat で FakeClock を 60 秒進めるごとに beat が走る |  |
| TC-UT_SCH-024 | scheduleDayRollover | 正常系 | 境界値 | 23:59:59.999 では走らず、00:00:00.000 UTC で走る | 一時 DB（createTestDb）、初回の世界、時計 2026-10-22T23:59:59.000Z | 23:59:59.999 まで進める → 00:00:00.000 まで進める | 前は daily_usage なし、後は 2026-10-23 の行 | B6-F | FakeClock 2026-10-22T23:59:59.000Z、scheduler.wake を vi.fn | 一部 TC-NOUS60_DEV-10（分の単位で越えるだけで、1 ミリ秒前の両側は見ていない） |  | TC-UT_SCH-024 scheduleDayRollover は 23:59:59.999 では走らず、00:00:00.000 UTC で走る |  |
| TC-UT_SCH-025 | rolloverDay | 正常系 | 境界値 | 利用日は now の UTC の日付になる | 一時 DB（createTestDb）、初回の世界 | now = 2026-10-22T23:59:59.999Z、2026-10-23T00:00:00.000Z | usage_date 2026-10-22、2026-10-23（daily_usage・daily_metrics とも） | B1-F | FakeClock 2026-10-22T23:59:59.000Z、scheduler.wake を vi.fn | 一部 TC-NOUS60_DEV-05（00:00 だけ） |  | TC-UT_SCH-025 rolloverDay の利用日は now の UTC の日付になる |  |
| TC-UT_SCH-026 | rolloverDay | 異常系 | 分岐網羅 | 現在の世界がないときは daily_usage だけを作り、resumed は false で wake を呼ばない | 一時 DB（createTestDb）（世界なし） | rolloverDay(2026-10-23T00:00:00.000Z) | resumed false、daily_usage 1 行、daily_metrics 0 行、wake は呼ばれない | B1-T, B4-F | scheduler.wake を vi.fn | なし |  | TC-UT_SCH-026 現在の世界がないときは daily_usage だけを作り、resumed は false で wake を呼ばない |  |
| TC-UT_SCH-027 | rolloverDay | 正常系 | 同値分割 | preparing の世界は状態を変えず、その世界の daily_metrics を作る | 一時 DB（createTestDb）、初回の世界（preparing） | rolloverDay(2026-10-23T00:00:00.000Z) | resumed false、preparing のまま、daily_metrics 2026-10-23 | B2-T | scheduler.wake を vi.fn | 一部 TC-NOUS60_DEV-08（preparing は入っていない） |  | TC-UT_SCH-027 preparing の世界は状態を変えず、その世界の daily_metrics を作る |  |
| TC-UT_SCH-028 | scheduleDayRollover | 異常系 | エラー処理 | 日の区切りの処理が例外になってもタイマーは止まらず、翌日にも呼ばれて error を記録する | DB を閉じる | 00:00 まで進める → 24 時間進める | error が 1 件 → 2 件。解除の後 pendingCount 0 | B6-T | FakeClock 2026-10-22T23:59:59.000Z、captureLogger | なし |  | TC-UT_SCH-028 日の区切りの処理が例外になってもタイマーは止まらず、翌日の 00:00 UTC にも呼ばれて error を記録する |  |
| TC-UT_SCH-029 | runBackup | 正常系 | 境界値 | バックアップがちょうど 7 件のときは 1 件も消さない | 一時 DB（createTestDb） | 10/01〜10/07 の 7 回 | 7 件が残る（20261001〜20261007） | B8-T, B9-F | 一時 DB（createTestDb）、一時ディレクトリ | 一部 TC-NOUS60_DEV-03（9 件だけ） |  | TC-UT_SCH-029 バックアップがちょうど 7 件のときは 1 件も消さない |  |
| TC-UT_SCH-030 | runBackup | 正常系 | 同値分割 | 名前の形が違うファイルは世代に数えず、消さない | 一時 DB（createTestDb）、aisns-2026-10-01.db・aisns-20261001-000.db・aisns-20261001-0000.db.bak・other.db を置く | 10/01〜10/08 の 8 回 | 正しい形は 7 件（20261002 から）。形の違う 4 件は残る | B8-F, B9-T | 一時 DB（createTestDb）、一時ディレクトリ | 一部 TC-NOUS60_DEV-03（README.txt だけ） |  | TC-UT_SCH-030 名前の形が aisns-YYYYMMDD-HHMM.db でないファイルは世代に数えず、消さない |  |
| TC-UT_SCH-031 | backupFileName | 正常系 | 境界値 | UTC の分までで名前を作り、秒以下は切り捨てる | なし | 2026-10-22T23:59:59.999Z、2026-12-31T23:59:00.000Z、2027-01-01T00:00:00.000Z | aisns-20261022-2359.db、aisns-20261231-2359.db、aisns-20270101-0000.db |  | なし | 一部 TC-NOUS60_DEV-01（日の区切りと年の変わり目は見ていない） |  | TC-UT_SCH-031 backupFileName は UTC の分までで名前を作り、秒以下は切り捨てる |  |
| TC-UT_SCH-032 | runBackup | 異常系 | エラー処理 | BackupError の name が BackupError で、メッセージに作ろうとしたファイル名を含む | DB を閉じる | runBackup(2026-10-22T00:00) | name BackupError、message に aisns-20261022-0000.db | B11-T | 一時 DB（createTestDb） | 一部 TC-NOUS60_DEV-04（cause だけ） |  | TC-UT_SCH-032 失敗したときの BackupError は name が BackupError で、メッセージに作ろうとしたファイル名を含む |  |
| TC-UT_SCH-033 | runBackup | 正常系 | 分岐網羅 | logger を渡すと、作ったファイルのパスを info で記録する | 一時 DB（createTestDb） | logger 付きで runBackup(2026-10-22T00:00) | 戻り値のパス、info にファイル名 | B10-T | 一時 DB（createTestDb）、captureLogger | なし（DEV は logger なし） |  | TC-UT_SCH-033 logger を渡すと、作ったファイルのパスを info で記録する |  |
| TC-UT_SCH-034 | recoverOnStartup | 異常系 | 分岐網羅 | 現在の世界がない（archived だけ）ときも、その世界の running の生成イベントを閉じ、worldPatched は false | archived の世界と running の生成イベント 1 件 | recoverOnStartup(2026-10-23T05:00)、logger なし | closedEvents 1、worldPatched false。行は interrupted、finished_at 05:00 | B12-F, B14-F | FakeClock 2026-10-23T05:00:00.000Z | なし（DEV-11 は現在の世界の行だけ） |  | TC-UT_SCH-034 現在の世界がない（archived だけ）ときも、その世界の running の生成イベントを interrupted で閉じ、worldPatched は false |  |
| TC-UT_SCH-035 | recoverOnStartup | 正常系 | 同値分割 | paused の世界は世界内時間を補正しない | paused の世界（elapsed 300） | recoverOnStartup | worldPatched false、elapsed 300・running_since NULL のまま | B12-T, B13-F | FakeClock 2026-10-23T05:00:00.000Z | なし |  | TC-UT_SCH-035 paused の世界は世界内時間を補正しない |  |
| TC-UT_SCH-036 | recoverOnStartup | 正常系 | 境界値 | heartbeat_at が NULL の running の世界は running_since までで補正し（0 秒足す）、running_since と heartbeat_at を now にする | running の世界（elapsed 120、running_since 00:00、heartbeat_at NULL） | recoverOnStartup(05:00) | worldPatched true、elapsed 120、running_since・heartbeat_at 05:00 | B12-T, B13-T | FakeClock 2026-10-23T05:00:00.000Z | 一部 TC-NOUS60_DEV-12（heartbeat_at があるときだけ） |  | TC-UT_SCH-036 heartbeat_at が NULL の running の世界は running_since までで補正し（足す秒は 0）、running_since と heartbeat_at を now にする |  |
| TC-UT_SCH-037 | recoverOnStartup | 正常系 | 境界値 | running の生成イベントも期限切れのセッションもないときは、どの件数も 0 を返す | 初回の世界（preparing）だけ | recoverOnStartup | { closedEvents 0, worldPatched false, deletedSessions 0 } | B12-T, B13-F | FakeClock 2026-10-23T05:00:00.000Z | なし |  | TC-UT_SCH-037 running の生成イベントも期限切れのセッションもないときは、どの件数も 0 を返す |  |
| TC-UT_SCH-038 | beat | 正常系 | 境界値 | 前回の heartbeat_at からの空白が 180 秒ちょうどなら補正せず、181 秒なら補正する | running の世界（running_since・heartbeat_at 09:00） | now = 09:03:00、09:03:01 | 180 秒は corrected false・running_since そのまま、181 秒は corrected true・running_since が now。heartbeat_at はどちらも now | B18-T, B18-F | FakeClock 2026-10-22T09:00:00.000Z、scheduler.wake を vi.fn | 一部 TC-NOUS60_DEV-15・16（境目の両側は見ていない） |  | TC-UT_SCH-038 前回の heartbeat_at からの空白が 180 秒ちょうどなら補正せず、181 秒なら補正する |  |
| TC-UT_SCH-039 | beat | 正常系 | 境界値 | next_cycle_at の 1 ミリ秒前では wake を呼ばず、ちょうどで呼ぶ | running の世界、next_cycle_at 09:01:00.000 | now = 09:00:59.999、09:01:00.000 | woke false・wake 0 回、woke true・wake 1 回 | B19-T, B19-F | FakeClock 2026-10-22T09:00:00.000Z、scheduler.wake を vi.fn | 一部 TC-NOUS60_DEV-17（過ぎたときだけ） |  | TC-UT_SCH-039 next_cycle_at の 1 ミリ秒前では wake を呼ばず、ちょうどで呼ぶ |  |
| TC-UT_SCH-040 | beat | 正常系 | 分岐網羅 | next_cycle_at が NULL なら wake を呼ばない | running の世界、next_cycle_at NULL | now = 09:01:00 | { updated true, corrected false, woke false } | B19-F | FakeClock 2026-10-22T09:00:00.000Z、scheduler.wake を vi.fn | なし |  | TC-UT_SCH-040 next_cycle_at が NULL なら wake を呼ばない |  |
| TC-UT_SCH-041 | beat | 異常系 | 分岐網羅 | 現在の世界がないときは何もしない | 一時 DB（createTestDb）（世界なし） | beat(09:00) | すべて false、wake は呼ばれない | B15-T | FakeClock 2026-10-22T09:00:00.000Z、scheduler.wake を vi.fn | なし（DEV-14 は世界があって running でないとき） |  | TC-UT_SCH-041 現在の世界がないときは何もしない |  |
| TC-UT_SCH-042 | scheduleHeartbeat | 異常系 | エラー処理 | beat が例外になってもタイマーは止まらず、次の 60 秒でも呼ばれて error を記録する | DB を閉じる | 60 秒進める → 60 秒進める | error が 1 件 → 2 件 | B20-T | FakeClock 2026-10-22T09:00:00.000Z、scheduler.wake を vi.fn、captureLogger | なし |  | TC-UT_SCH-042 beat が例外になってもタイマーは止まらず、次の 60 秒でも呼ばれて error を記録する |  |
| TC-UT_SCH-043 | scheduleHeartbeat | 正常系 | 状態遷移 | スリープからの復帰（FakeClock.jump で 10 分）で、最後の生存時刻までを世界内時間に足し、warn を記録する | running の世界（elapsed 0、09:00 から） | 60 秒進める → jump 10 分 | world_elapsed_sec 60、running_since・heartbeat_at 09:11:00、warn 1 件 | B18-T | FakeClock 2026-10-22T09:00:00.000Z（jump）、scheduler.wake を vi.fn、captureLogger | 一部 TC-NOUS60_DEV-16（beat を直接呼ぶだけで、タイマーと jump は見ていない） |  | TC-UT_SCH-043 スリープからの復帰（FakeClock.jump で 10 分）で、最後の生存時刻までを世界内時間に足し、warn を記録する |  |

## 3. 確認事項・バグの疑い

- 確認事項 1：B3-F（rolloverDay の楽観の確認で 0 行）と B17-T（beat の UPDATE が 0 行）は、同じ接続で同期に読んで書くため、単体テストでは起こせない。ケースを作っていない。
- 確認事項 2：B07 は設計書（world 4章 recoverOnStartup）で「closeOrphanEvents は全世界」としているので、archived の世界の running の行も閉じることを期待値にした（TC-UT_SCH-034）。
- 確認事項 3：00:00 UTC を求める onUtcMidnight は clock.ts（NOUS-96 の範囲）なので、ここでは scheduleDayRollover を通して 23:59:59.999 と 00:00:00.000 の両側だけを見る。
