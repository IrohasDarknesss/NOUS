# 単体テスト観点表：起動と終了（main.ts・index.ts）

| 項目 | 内容 |
|---|---|
| 関連チケット | NOUS-98 |
| 作成者 | Mark Zuckerberg（開発担当） |
| 作成日 | 2026-10-23 |
| 対象 | apps/server/src/main.ts, apps/server/src/index.ts |
| 言語 / フレームワーク | TypeScript / Vitest 2.1.9（environment: node） |
| テストファイル | apps/server/src/main.test.ts（実装時、NOUS-60）, apps/server/src/main.ut.test.ts（単体テストで追加） |
| 外部依存 | DB（一時 DB）, 時計（FakeClock）, 観察・管理サーバー（差し替え）, recover・backup・createScheduler（差し替え）, config/generation.json（BOOT-007 だけ実物） |
| 入力にした設計書 | BE 詳細設計 world 1章（起動のシーケンス）・4章（IPO）・5章（B01・B02・B06・B07・B08）・6章（例外・トランザクション） |

このファイルは `docs/test/unit/_build/build_matrix.py` で JSON から作る。直すときは JSON を直して作り直す。

## 1. 分岐の一覧

| ID | 条件 | 場所 |
|---|---|---|
| B1 | closeServerHandle：Node のサーバー（listen がある） | main.ts:63 |
| B2 | startApp：env・clock・logger・db を省略したときの既定（??） | main.ts:83-86 |
| B3 | startApp：現在の世界がない（createInitialWorld） | main.ts:92 |
| B4 | startApp：起動時のバックアップの失敗（catch） | main.ts:103 |
| B5 | startApp：options.createScheduler を渡した | main.ts:110 |
| B6 | close：closed（2 回目） | main.ts:149 |
| B7 | startApp：起動の失敗（catch） | main.ts:159 |
| B8 | startApp の catch：options.db を渡していない（自分で開いた DB を閉じる） | main.ts:160 |
| B9 | isMainModule（node で直接起動したとき、SIGINT・SIGTERM の登録） | main.ts:169 |

## 2. ケースの一覧（11 件。うち新しく足したもの 7 件）

| ID | 対象 | 分類 | 技法 | 観点 | 前提 | 入力 | 期待結果 | 分岐 | モック | 既存テストとの対応 | バグの疑い | テスト名 | 備考 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| TC-NOUS60_DEV-19 | startApp | 正常系 | 開発者テスト | 起動の順が recover → backup → observer → admin → scheduler.start で、初回の世界が作られ、Scheduler が管理 API に渡る | 世界なし | startApp | 順が一致、世界「世界 2026-10-22」、resolveScheduler が渡した Scheduler | B2-F, B3-T, B4-F, B5-T, B7-F | FakeClock 2026-10-22T00:00:00.000Z、一時 DB、recover・backup・startObserver・startAdmin・createScheduler を差し替え | 実装時のテスト（NOUS-60） |  | TC-NOUS60_DEV-19 startApp の順が recover → backup → observer → admin → scheduler.start であり、初回の世界が作られ、Scheduler が管理 API に渡る |  |
| TC-NOUS60_DEV-20 | startApp | 異常系 | 開発者テスト | バックアップが失敗してもエラーを記録して起動が続く | 世界なし | backup が BackupError | 順は同じで起動する、error が記録される | B4-T | FakeClock 2026-10-22T00:00:00.000Z、一時 DB、recover・backup・startObserver・startAdmin・createScheduler を差し替え | 実装時のテスト（NOUS-60） |  | TC-NOUS60_DEV-20 バックアップが失敗してもエラーを記録して起動が続く |  |
| TC-NOUS60_DEV-21 | startApp | 異常系 | 開発者テスト | recover が失敗したらサーバーや Scheduler を起動せず例外を投げる | 世界なし | recover が Error | recover failed で拒否、recover の後は何も呼ばれない | B7-T | FakeClock 2026-10-22T00:00:00.000Z、一時 DB、recover・backup・startObserver・startAdmin・createScheduler を差し替え | 実装時のテスト（NOUS-60） |  | TC-NOUS60_DEV-21 recover が失敗したらサーバーや Scheduler を起動せず例外を投げる |  |
| TC-NOUS60_DEV-22 | startApp / close | 正常系 | 開発者テスト | close でタイマー・scheduler・両サーバー・DB が止まる | 世界なし | startApp → close | タイマー 2 → 0、scheduler.stop → admin → observer の順、DB が閉じる | B1-F, B6-F | FakeClock 2026-10-22T00:00:00.000Z、一時 DB、recover・backup・startObserver・startAdmin・createScheduler を差し替え | 実装時のテスト（NOUS-60） |  | TC-NOUS60_DEV-22 close でタイマー・scheduler・両サーバー・DB が止まる |  |
| TC-UT_BOOT-001 | startApp | 正常系 | 分岐網羅 | 現在の世界がすでにあるときは初回の世界を作らず、その世界のまま起動する | running の世界 1 つ | startApp → close | worlds は 1 行のまま、現在の世界は同じ world_id | B3-F | FakeClock 2026-10-22T23:58:00.000Z、一時 DB、recover・backup・startObserver・startAdmin・createScheduler を差し替え | なし（DEV-19 は世界なしだけ） |  | TC-UT_BOOT-001 現在の世界がすでにあるときは初回の世界を作らず、その世界のまま起動する |  |
| TC-UT_BOOT-002 | startApp | 正常系 | 依存 | recover と backup に起動時の時刻を渡し、backup には env.backupDir を渡す | 世界なし | startApp → close | recover は (db・clock, 23:58)、backup は (db・backupDir, 23:58) で呼ばれる |  | FakeClock 2026-10-22T23:58:00.000Z、一時 DB、recover・backup・startObserver・startAdmin・createScheduler を差し替え | 一部 TC-NOUS60_DEV-19（呼ばれた順だけで引数は見ていない） |  | TC-UT_BOOT-002 recover と backup に起動時の時刻を渡し、backup には env.backupDir を渡す |  |
| TC-UT_BOOT-003 | close | 正常系 | 分岐網羅 | close を 2 回呼んでも、Scheduler の停止とサーバーの終了は 1 回だけ | 世界なし | close を 2 回 | scheduler.stop・observer.close・admin.close がそれぞれ 1 回 | B6-T | FakeClock 2026-10-22T23:58:00.000Z、一時 DB、recover・backup・startObserver・startAdmin・createScheduler を差し替え | なし |  | TC-UT_BOOT-003 close を 2 回呼んでも、Scheduler の停止とサーバーの終了は 1 回だけ |  |
| TC-UT_BOOT-004 | startApp | 異常系 | エラー処理 | 管理サーバーの起動に失敗したら例外を投げ、起動済みの観察サーバーを閉じ、Scheduler を動かさない | 世界なし | startAdmin が Error('admin bind failed') | admin bind failed で拒否。scheduler.start は呼ばれない。観察サーバーの close が 1 回。タイマーは張られない | B7-T | FakeClock 2026-10-22T23:58:00.000Z、一時 DB、recover・backup・startObserver・startAdmin・createScheduler を差し替え | なし | startApp の catch は自分で開いた DB を閉じるだけで、起動済みの観察サーバーを閉じない。実際の起動では観察サーバーの待ち受けが残り、exitCode=1 でもプロセスが終わらない疑い（設計書 world 4章 startApp：起動時の例外は起動を止める） | TC-UT_BOOT-004 管理サーバーの起動に失敗したら例外を投げ、起動済みの観察サーバーを閉じ、Scheduler を動かさない |  |
| TC-UT_BOOT-005 | startApp | 異常系 | 分岐網羅 | options.db を渡して起動に失敗したときは、渡された DB を閉じない | 世界なし | recover が Error | recover failed で拒否、t.db は開いたまま | B7-T, B8-F | FakeClock 2026-10-22T23:58:00.000Z、一時 DB、recover・backup・startObserver・startAdmin・createScheduler を差し替え | 一部 TC-NOUS60_DEV-21（DB の開閉は見ていない） |  | TC-UT_BOOT-005 options.db を渡して起動に失敗したときは、渡された DB を閉じない |  |
| TC-UT_BOOT-006 | startApp（B08・B02 のタイマー） | 正常系 | 境界値 | 起動後、60 秒ごとに生存時刻が更新され、00:00:00.000 UTC で日の区切りが走る（23:59:59.999 では走らない） | running の世界（running_since 23:58） | 60 秒進める → 23:59:59.999 まで → 00:00:00.000 まで | heartbeat_at 23:59:00.000、23:59:59.999 では daily_usage 0 行、00:00 で 2026-10-23 の行 |  | FakeClock 2026-10-22T23:58:00.000Z、一時 DB、recover・backup・サーバー・Scheduler を差し替え（B08・B02 は実物） | 一部 TC-NOUS60_DEV-22（タイマーが 2 つ張られることだけ） |  | TC-UT_BOOT-006 起動後、FakeClock で 60 秒ごとに生存時刻が更新され、00:00:00.000 UTC で日の区切りが走る（23:59:59.999 では走らない） |  |
| TC-UT_BOOT-007 | startApp | 正常系 | 分岐網羅 | createScheduler を渡さないときは、既定の Scheduler を作って管理 API に渡し、close で止める | 世界なし（preparing の世界ができる） | createScheduler を省いて startApp → close | resolveScheduler が app.scheduler と同じ、runningCount を持つ、close の後 pendingCount 0 | B5-F | FakeClock 2026-10-22T23:58:00.000Z、一時 DB、recover・backup・サーバーを差し替え（Scheduler・generation.json・固定応答の LlmClient は実物） | なし |  | TC-UT_BOOT-007 createScheduler を渡さないときは、既定の Scheduler を作って管理 API に渡し、close で止める |  |

## 3. 確認事項・バグの疑い

- 疑い 1：startApp で管理サーバーの起動に失敗したとき（AdminBindError など）、起動済みの観察サーバーを閉じない。待ち受けが残るとプロセスが終わらない可能性がある（TC-UT_BOOT-004）。
- 確認事項 1：B1-T（Node のサーバーの close）・B2（env・clock・logger・db の既定）・B8-T（自分で開いた DB を閉じる）・B9（直接起動とシグナル）は、実際のポートや環境変数・プロセスを使うため単体テストでは扱わず、結合テスト以降で見る。
- 確認事項 2：apps/server/src/index.ts は `export {};` だけで処理がないため、観点を作っていない。
