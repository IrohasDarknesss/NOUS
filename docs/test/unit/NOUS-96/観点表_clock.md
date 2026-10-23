# 単体テスト観点表：時計（clock/clock.ts・clock/fakeClock.ts）

| 項目 | 内容 |
|---|---|
| 関連チケット | NOUS-96 |
| 作成者 | Mark Zuckerberg（開発担当） |
| 作成日 | 2026-10-23 |
| 対象 | apps/server/src/clock/clock.ts, apps/server/src/clock/fakeClock.ts |
| 言語 / フレームワーク | TypeScript / Vitest 2.1.9（environment: node） |
| テストファイル | apps/server/src/clock/clock.test.ts（実装時、NOUS-45）, apps/server/src/clock/clock.ut.test.ts（単体テストで追加）, apps/server/src/clock/fakeClock.ut.test.ts（単体テストで追加） |
| 外部依存 | 実時刻とタイマー（Date.now・setTimeout・setInterval。SystemClock だけが使う）, 環境変数 NODE_ENV・AISNS_CLOCK（createClock）, AbortSignal（sleep の取り消し） |
| 入力にした設計書 | BE 詳細設計 world 1章（clock/ の構成）・4章（now・sleep・setTimer、advance、createClock）, 基本設計書_概要 9章「時計の差し替え」 |

このファイルは `docs/test/unit/_build/build_matrix.py` で JSON から作る。直すときは JSON を直して作り直す。

## 1. 分岐の一覧

| ID | 条件 | 場所 |
|---|---|---|
| B1 | createClock の env を省略（既定の process.env） | clock.ts:120 |
| B2 | env.AISNS_CLOCK === "fake" | clock.ts:121 |
| B3 | env.NODE_ENV === "test" | clock.ts:122 |
| B4 | env.NODE_ENV === "production" | clock.ts:123 |
| B5 | onUtcMidnight のタイマーの中で cancelled（解除の後に発火した） | clock.ts:51 |
| B6 | SystemClock.sleep：signal が abort 済み | clock.ts:84 |
| B7 | SystemClock.sleep：期限より先に abort された（onAbort が走る） | clock.ts:88-96 |
| B8 | FakeClock の開始時刻が数値（typeof start === "number"。省略時の Date.now() を含む） | fakeClock.ts:27 |
| B9 | FakeClock.sleep：signal が abort 済み | fakeClock.ts:44 |
| B10 | FakeClock.sleep：期限より先に abort された（onAbort が走る） | fakeClock.ts:48-56 |
| B11 | setRepeatingTimer の ms <= 0 | fakeClock.ts:65 |
| B12 | advance の ms < 0 | fakeClock.ts:74 |
| B13 | advance のループ：目標の時刻までに期限の来たタイマーがある（!timer の偽） | fakeClock.ts:76-78 |
| B14 | advanceTo の時刻が数値 | fakeClock.ts:89 |
| B15 | jump の ms < 0 | fakeClock.ts:98 |
| B16 | jump：期限の来たタイマーが、先に呼んだタイマーの中で解除済み | fakeClock.ts:102 |
| B17 | addTimer：ms が負（Math.max で 0 にする） | fakeClock.ts:115 |
| B18 | fire：1回だけのタイマー・sleep（intervalMs === undefined） | fakeClock.ts:127 |
| B19 | fire：本来の次の期限が現在時刻以前（jump の後） | fakeClock.ts:132 |

## 2. ケースの一覧（49 件。うち新しく足したもの 28 件）

| ID | 対象 | 分類 | 技法 | 観点 | 前提 | 入力 | 期待結果 | 分岐 | モック | 既存テストとの対応 | バグの疑い | テスト名 | 備考 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| TC-NOUS45_DEV-01 | createClock | 正常系 | 開発者テスト | AISNS_CLOCK=fake かつ NODE_ENV=test のときだけ FakeClock を返す | なし | { NODE_ENV: "test", AISNS_CLOCK: "fake" } | FakeClock のインスタンス | B1-F, B2-T, B3-T | なし | 実装時のテスト（NOUS-45） |  | TC-NOUS45_DEV-01 AISNS_CLOCK=fake かつ NODE_ENV=test のときだけ FakeClock を返す |  |
| TC-NOUS45_DEV-02 | createClock | 正常系 | 開発者テスト | AISNS_CLOCK が未指定・system なら SystemClock を返す | なし | { NODE_ENV: "test" }、{ NODE_ENV: "test", AISNS_CLOCK: "system" }、{ NODE_ENV: "production" } | どれも SystemClock | B1-F, B2-F | なし | 実装時のテスト（NOUS-45） |  | TC-NOUS45_DEV-02 AISNS_CLOCK が未指定・system なら SystemClock を返す |  |
| TC-NOUS45_DEV-03 | createClock | 正常系 | 開発者テスト | development で fake を指定しても SystemClock を返す | なし | { NODE_ENV: "development", AISNS_CLOCK: "fake" } | SystemClock | B2-T, B3-F, B4-F | なし | 実装時のテスト（NOUS-45） |  | TC-NOUS45_DEV-03 development で fake を指定しても SystemClock を返す |  |
| TC-NOUS45_DEV-04 | createClock | 異常系 | 開発者テスト | production で fake を指定すると ConfigError | なし | { NODE_ENV: "production", AISNS_CLOCK: "fake" } | ConfigError を投げる | B2-T, B3-F, B4-T | なし | 実装時のテスト（NOUS-45） |  | TC-NOUS45_DEV-04 production で fake を指定すると ConfigError |  |
| TC-NOUS45_DEV-05 | utcDate | 正常系 | 開発者テスト | utcDate は UTC の日付を返す | なし | 2026-10-20T23:59:59.999Z、2026-10-21T00:00:00.000Z | "2026-10-20"、"2026-10-21" |  | なし | 実装時のテスト（NOUS-45） |  | TC-NOUS45_DEV-05 utcDate は UTC の日付を返す |  |
| TC-NOUS45_DEV-06 | nextUtcMidnight / msUntilNextUtcMidnight | 正常系 | 開発者テスト | nextUtcMidnight は次の 00:00 UTC、ちょうど 00:00 なら翌日 | なし | 2026-10-20T23:58:00.000Z、2026-10-21T00:00:00.000Z | 2026-10-21T00:00:00.000Z、2026-10-22T00:00:00.000Z。23:58 からの残りは 120000 |  | なし | 実装時のテスト（NOUS-45） |  | TC-NOUS45_DEV-06 nextUtcMidnight は次の 00:00 UTC、ちょうど 00:00 なら翌日 |  |
| TC-NOUS45_DEV-07 | addMs | 正常系 | 開発者テスト | addMs は ms の後の時刻を返す | なし | 2026-10-20T23:58:00.000Z、60000 | 2026-10-20T23:59:00.000Z |  | なし | 実装時のテスト（NOUS-45） |  | TC-NOUS45_DEV-07 addMs は ms の後の時刻を返す |  |
| TC-NOUS45_DEV-08 | FakeClock.now / nowMs / nowIso / advance | 正常系 | 開発者テスト | 時刻は advance でだけ進む | FakeClock 2026-10-20T23:58:00.000Z | advance(1500) | 2026-10-20T23:58:01.500Z | B8-F, B12-F, B13-F | なし | 実装時のテスト（NOUS-45） |  | TC-NOUS45_DEV-08 時刻は advance でだけ進む |  |
| TC-NOUS45_DEV-09 | FakeClock.sleep | 正常系 | 開発者テスト | sleep は期限まで進めたときに解決する | FakeClock 2026-10-20T23:58:00.000Z | sleep(30000)、advance(29999) → advance(1) | 29999 では未解決、30000 で解決。pendingCount 0 | B9-F, B10-F, B13-T, B18-T | なし | 実装時のテスト（NOUS-45） |  | TC-NOUS45_DEV-09 sleep は期限まで進めたときに解決する |  |
| TC-NOUS45_DEV-10 | FakeClock.sleep | 異常系 | 開発者テスト | sleep は signal の abort で CancelledError として拒否する | FakeClock 2026-10-20T23:58:00.000Z | sleep(120000, signal) → abort() | CancelledError で拒否。pendingCount 0 | B9-F, B10-T | なし | 実装時のテスト（NOUS-45） |  | TC-NOUS45_DEV-10 sleep は signal の abort で CancelledError として拒否する |  |
| TC-NOUS45_DEV-11 | FakeClock.sleep | 異常系 | 開発者テスト | abort 済みの signal なら sleep はすぐ拒否する | FakeClock 2026-10-20T23:58:00.000Z | abort 済みの signal で sleep(1000) | CancelledError で拒否 | B9-T | なし | 実装時のテスト（NOUS-45） |  | TC-NOUS45_DEV-11 abort 済みの signal なら sleep はすぐ拒否する |  |
| TC-NOUS45_DEV-12 | FakeClock.setTimer / advance | 正常系 | 開発者テスト | タイマーは期限の順に、その時刻で発火する | FakeClock 2026-10-20T23:58:00.000Z | setTimer 3000・1000・3000 → advance(5000) | a@1000、b@3000、c@3000 の順 | B13-T, B18-T | なし | 実装時のテスト（NOUS-45） |  | TC-NOUS45_DEV-12 タイマーは期限の順に、その時刻で発火する |  |
| TC-NOUS45_DEV-13 | FakeClock.setTimer | 正常系 | 開発者テスト | 解除したタイマーは発火しない | FakeClock 2026-10-20T23:58:00.000Z | setTimer(1000) → 解除 → advance(2000) | callback を呼ばない | B13-F | なし | 実装時のテスト（NOUS-45） |  | TC-NOUS45_DEV-13 解除したタイマーは発火しない |  |
| TC-NOUS45_DEV-14 | FakeClock.setRepeatingTimer | 正常系 | 開発者テスト | 繰り返しのタイマーは間隔ごとに発火する（B08 の 60 秒） | FakeClock 2026-10-20T23:58:00.000Z | setRepeatingTimer(60000) → advance(180000) → 解除 → advance(60000) | 3 回呼び、解除の後は増えない | B11-F, B13-T, B18-F, B19-F | なし | 実装時のテスト（NOUS-45） |  | TC-NOUS45_DEV-14 繰り返しのタイマーは間隔ごとに発火する（B08 の 60 秒） |  |
| TC-NOUS45_DEV-15 | FakeClock.sleep / advance | 正常系 | 開発者テスト | sleep の後に張った次の sleep も、同じ advance の中で解決する（周期の連続） | FakeClock 2026-10-20T23:58:00.000Z | sleep(10000) を 3 回続ける → advance(30000) | 10000・20000・30000 で起きる | B13-T, B18-T | なし | 実装時のテスト（NOUS-45） |  | TC-NOUS45_DEV-15 sleep の後に張った次の sleep も、同じ advance の中で解決する（周期の連続） |  |
| TC-NOUS45_DEV-16 | onUtcMidnight | 正常系 | 開発者テスト | onUtcMidnight は 00:00 UTC ごとに発火する（B02・B06） | FakeClock 2026-10-20T23:58:00.000Z | advance(2 分＋1 日) → 解除 → advance(1 日) | 2026-10-21T00:00:00.000Z と 2026-10-22T00:00:00.000Z の 2 回。解除の後は増えない | B5-F, B13-T, B18-T | なし | 実装時のテスト（NOUS-45） |  | TC-NOUS45_DEV-16 onUtcMidnight は 00:00 UTC ごとに発火する（B02・B06） |  |
| TC-NOUS45_DEV-17 | FakeClock.jump | 正常系 | 開発者テスト | jump はスリープからの復帰を再現し、取りこぼしたタイマーを復帰後の時刻で1回ずつ呼ぶ | FakeClock 2026-10-20T23:58:00.000Z | setRepeatingTimer(60000) → jump(600000) → advance(60000) | 600000 で 1 回、次は 660000 | B15-F, B16-F, B18-F, B19-T | なし | 実装時のテスト（NOUS-45） |  | TC-NOUS45_DEV-17 jump はスリープからの復帰を再現し、取りこぼしたタイマーを復帰後の時刻で1回ずつ呼ぶ |  |
| TC-NOUS45_DEV-18 | FakeClock.advanceTo / advance | 異常系 | 開発者テスト | advanceTo は指定の時刻まで進め、時刻を戻す指定は RangeError | FakeClock 2026-10-20T23:58:00.000Z | advanceTo(2026-10-21T00:00:00.000Z)、advance(-1) | 時刻が 2026-10-21T00:00:00.000Z。advance(-1) は RangeError | B14-F, B12-T | なし | 実装時のテスト（NOUS-45） |  | TC-NOUS45_DEV-18 advanceTo は指定の時刻まで進め、時刻を戻す指定は RangeError |  |
| TC-NOUS45_DEV-19 | SystemClock.now / nowMs / nowIso | 正常系 | 開発者テスト | now・nowIso は実時刻を返す | vi.useFakeTimers（2026-10-20T23:58:00.000Z） | now()・nowIso()・nowMs() | 2026-10-20T23:58:00.000Z |  | Date.now（vi.useFakeTimers） | 実装時のテスト（NOUS-45） |  | TC-NOUS45_DEV-19 now・nowIso は実時刻を返す |  |
| TC-NOUS45_DEV-20 | SystemClock.sleep | 正常系 | 開発者テスト | sleep は ms の後に解決し、abort で CancelledError | vi.useFakeTimers | sleep(1000) → 1000 進める、sleep(1000, signal) → abort() | 1 本目は解決、2 本目は CancelledError | B6-F, B7-F, B7-T | setTimeout（vi.useFakeTimers） | 実装時のテスト（NOUS-45） |  | TC-NOUS45_DEV-20 sleep は ms の後に解決し、abort で CancelledError |  |
| TC-NOUS45_DEV-21 | SystemClock.setTimer / setRepeatingTimer | 正常系 | 開発者テスト | setTimer・setRepeatingTimer は解除の関数を返す | vi.useFakeTimers | setTimer(1000)・setRepeatingTimer(1000) → 3000 進める → 解除 → 3000 進める | 1 回だけと 3 回 |  | setTimeout・setInterval（vi.useFakeTimers） | 実装時のテスト（NOUS-45） |  | TC-NOUS45_DEV-21 setTimer・setRepeatingTimer は解除の関数を返す |  |
| TC-UT_CLK-001 | utcDate / nextUtcMidnight / msUntilNextUtcMidnight | 正常系 | 境界値 | 日の区切りの直前（23:59:59.999）は当日の日付で、次の 00:00 UTC まで 1 ms | なし | 2026-10-21T23:59:59.999Z | utcDate は "2026-10-21"、nextUtcMidnight は 2026-10-22T00:00:00.000Z、残りは 1 |  | なし | 一部 TC-NOUS45_DEV-05（日付だけ。残りの ms は見ていない） |  | TC-UT_CLK-001 日の区切りの直前（23:59:59.999）は当日の日付で、次の 00:00 UTC まで 1 ms |  |
| TC-UT_CLK-002 | utcDate / msUntilNextUtcMidnight | 正常系 | 境界値 | ちょうど 00:00:00.000 UTC は新しい日付で、次の区切りまで 24 時間 | なし | 2026-10-22T00:00:00.000Z | utcDate は "2026-10-22"、残りは 86400000 |  | なし | 一部 TC-NOUS45_DEV-06（次の時刻だけ。残りの ms は見ていない） |  | TC-UT_CLK-002 ちょうど 00:00:00.000 UTC は新しい日付で、次の区切りまで 24 時間 |  |
| TC-UT_CLK-003 | addMs | 正常系 | 同値分割 | addMs は 0 と負の ms も足し引きし、元の Date を変えない | なし | 2026-10-22T00:00:00.000Z と 0、-1 | 同じ時刻、2026-10-21T23:59:59.999Z。元の Date は変わらない |  | なし | なし（DEV-07 は正の ms だけ） |  | TC-UT_CLK-003 addMs は 0 と負の ms も足し引きし、元の Date を変えない |  |
| TC-UT_CLK-004 | createClock | 正常系 | 分岐網羅 | env を省略すると process.env を読む | vi.stubEnv で NODE_ENV=test、AISNS_CLOCK=fake | createClock() | FakeClock | B1-T, B2-T, B3-T | process.env（vi.stubEnv。afterEach で vi.unstubAllEnvs） | なし（DEV は env をすべて引数で渡している） |  | TC-UT_CLK-004 env を省略すると process.env を読む |  |
| TC-UT_CLK-005 | createClock | 正常系 | 同値分割 | NODE_ENV が未設定のまま fake を指定したら SystemClock を返し、例外にしない | なし | { AISNS_CLOCK: "fake" } | SystemClock | B2-T, B3-F, B4-F | なし | なし（DEV-03 は development のとき） |  | TC-UT_CLK-005 NODE_ENV が未設定のまま fake を指定したら SystemClock を返し、例外にしない | 設計書（world 4章）の「それ以外は SystemClock」による |
| TC-UT_CLK-006 | createClock | 正常系 | 同値分割 | AISNS_CLOCK の値は大文字・小文字を区別し、"FAKE" は fake とみなさない | なし | { NODE_ENV: "production", AISNS_CLOCK: "FAKE" }、{ NODE_ENV: "test", AISNS_CLOCK: "FAKE" } | どちらも SystemClock（ConfigError にしない） | B2-F | なし | なし（DEV は小文字の fake と system だけ） |  | TC-UT_CLK-006 AISNS_CLOCK の値は大文字・小文字を区別し、"FAKE" は fake とみなさない | 設計書に記載なし。実装の値（fake だけを特別に扱う） |
| TC-UT_CLK-007 | onUtcMidnight | 正常系 | 状態遷移 | 日をまたいで jump したら復帰の時刻に1回だけ呼び、次は翌日の 00:00 UTC に呼ぶ（遅れを持ち越さない） | FakeClock 2026-10-20T23:58:00.000Z | onUtcMidnight → jump(1 日) → advance(2 分) | jump の後に 2026-10-21T23:58:00.000Z で 1 回、advance の後に 2026-10-22T00:00:00.000Z で 2 回目 | B5-F, B13-T, B18-T | なし | なし（DEV-16 は advance だけ。DEV-17 は繰り返しのタイマー） |  | TC-UT_CLK-007 日をまたいで jump したら復帰の時刻に1回だけ呼び、次は翌日の 00:00 UTC に呼ぶ |  |
| TC-UT_CLK-008 | onUtcMidnight | 正常系 | 状態遷移 | callback の中で解除したら、次のタイマーは残らない | FakeClock 2026-10-20T23:58:00.000Z | callback の中で解除の関数を呼ぶ → advance(2 分＋2 日) | callback は 1 回だけ。pendingCount 0 | B5-F, B13-T, B18-T | なし | なし（DEV-16 は callback の外で解除） |  | TC-UT_CLK-008 callback の中で解除したら、次のタイマーは残らない |  |
| TC-UT_CLK-009 | onUtcMidnight | 異常系 | 分岐網羅 | 解除した後にタイマーが発火しても callback を呼ばず、張り直さない | なし | onUtcMidnight → 解除 → 控えておいたタイマーの callback を直接呼ぶ | callback を呼ばない。setTimer は最初の 1 回だけ | B5-T | Clock の差し替え（setTimer は callback を控えるだけで、解除しても消さない） | なし（FakeClock は解除したタイマーを呼ばないため、B5-T は差し替えでしか通らない） |  | TC-UT_CLK-009 解除した後にタイマーが発火しても callback を呼ばず、張り直さない |  |
| TC-UT_CLK-010 | onUtcMidnight | 正常系 | 境界値 | 23:59:59.999 から始めると 1 ms 後の 00:00 UTC に呼ぶ | FakeClock 2026-10-21T23:59:59.999Z | onUtcMidnight → advance(1) | 2026-10-22T00:00:00.000Z で 1 回 | B5-F, B13-T, B18-T | なし | なし（DEV-16 は 23:58 から） |  | TC-UT_CLK-010 23:59:59.999 から始めると 1 ms 後の 00:00 UTC に呼ぶ |  |
| TC-UT_CLK-011 | onUtcMidnight | 正常系 | 境界値 | ちょうど 00:00:00.000 から始めると、その時刻ではなく翌日の 00:00 UTC に呼ぶ | FakeClock 2026-10-22T00:00:00.000Z | onUtcMidnight → advance(0) → advance(86399999) → advance(1) | 86399999 までは呼ばない。86400000 で 2026-10-23T00:00:00.000Z に 1 回 | B5-F, B13-F, B13-T, B18-T | なし | なし |  | TC-UT_CLK-011 ちょうど 00:00:00.000 から始めると、その時刻ではなく翌日の 00:00 UTC に呼ぶ |  |
| TC-UT_CLK-012 | FakeClock（constructor） | 正常系 | 分岐網羅 | 開始時刻をエポックからの ms（数値）でも渡せる | なし | new FakeClock(Date.UTC(2026, 9, 22, 9)) | nowIso は 2026-10-22T09:00:00.000Z | B8-T | なし | なし（DEV は Date だけ） |  | TC-UT_CLK-012 開始時刻をエポックからの ms（数値）でも渡せる |  |
| TC-UT_CLK-013 | FakeClock.sleep | 正常系 | 境界値 | sleep(0) は時刻を進めずに advance(0) で解決する | FakeClock 2026-10-20T23:58:00.000Z | sleep(0) → advance(0) | 解決する。時刻は変わらない | B9-F, B13-T, B17-F, B18-T | なし | なし |  | TC-UT_CLK-013 sleep(0) は時刻を進めずに advance(0) で解決する |  |
| TC-UT_CLK-014 | FakeClock.sleep | 正常系 | 分岐網羅 | 負の ms の sleep は 0 として扱い、advance(0) で解決する | FakeClock 2026-10-20T23:58:00.000Z | sleep(-5000) → advance(0) | 解決する。時刻は変わらない | B13-T, B17-T, B18-T | なし | なし |  | TC-UT_CLK-014 負の ms の sleep は 0 として扱い、advance(0) で解決する | 設計書に記載なし。実装の値（Math.max(0, ms)） |
| TC-UT_CLK-015 | FakeClock.setRepeatingTimer | 異常系 | 境界値 | 繰り返しの間隔が 0 以下なら RangeError | FakeClock 2026-10-20T23:58:00.000Z | setRepeatingTimer(0)、setRepeatingTimer(-1) | どちらも RangeError。タイマーは張られない（pendingCount 0） | B11-T | なし | なし |  | TC-UT_CLK-015 繰り返しの間隔が 0 以下なら RangeError |  |
| TC-UT_CLK-016 | FakeClock.setRepeatingTimer | 正常系 | 境界値 | 繰り返しの間隔が 1 ms でも受け付け、1 ms ごとに呼ぶ | FakeClock 2026-10-20T23:58:00.000Z | setRepeatingTimer(1) → advance(3) | 3 回呼ぶ | B11-F, B13-T, B18-F, B19-F | なし | なし（DEV-14 は 60000） |  | TC-UT_CLK-016 繰り返しの間隔が 1 ms でも受け付け、1 ms ごとに呼ぶ |  |
| TC-UT_CLK-017 | FakeClock.setRepeatingTimer / advance | 正常系 | 境界値 | 繰り返しのタイマーは間隔の 1 ms 前では呼ばず、ちょうどで呼ぶ | FakeClock 2026-10-20T23:58:00.000Z | setRepeatingTimer(60000) → advance(59999) → advance(1) | 59999 では 0 回、60000 で 1 回 | B13-F, B13-T, B18-F, B19-F | なし | なし（DEV-14 は間隔の倍数だけ） |  | TC-UT_CLK-017 繰り返しのタイマーは間隔の 1 ms 前では呼ばず、ちょうどで呼ぶ |  |
| TC-UT_CLK-018 | FakeClock.jump | 異常系 | 境界値 | jump に負の ms を渡すと RangeError で、時刻は変わらない | FakeClock 2026-10-20T23:58:00.000Z | jump(-1) | RangeError。時刻は 2026-10-20T23:58:00.000Z のまま | B15-T | なし | なし（DEV-18 は advance の負だけ） |  | TC-UT_CLK-018 jump に負の ms を渡すと RangeError で、時刻は変わらない |  |
| TC-UT_CLK-019 | FakeClock.jump | 正常系 | 境界値 | jump(0) は今ちょうど期限のタイマーを呼ぶ | FakeClock 2026-10-20T23:58:00.000Z | setTimer(0) → jump(0) | 1 回呼ぶ。pendingCount 0 | B15-F, B16-F, B18-T | なし | なし |  | TC-UT_CLK-019 jump(0) は今ちょうど期限のタイマーを呼ぶ |  |
| TC-UT_CLK-020 | FakeClock.jump | 正常系 | 分岐網羅 | jump の中で先に呼んだタイマーが後のタイマーを解除したら、後のタイマーは呼ばない | FakeClock 2026-10-20T23:58:00.000Z | setTimer(1000, A：B を解除)・setTimer(2000, B) → jump(5000) | A だけ呼ぶ | B16-F, B16-T, B18-T | なし | なし |  | TC-UT_CLK-020 jump の中で先に呼んだタイマーが後のタイマーを解除したら、後のタイマーは呼ばない |  |
| TC-UT_CLK-021 | FakeClock.jump | 正常系 | 状態遷移 | jump で取りこぼした1回だけのタイマーは、期限の順に復帰後の時刻で呼ぶ | FakeClock 2026-10-20T23:58:00.000Z | setTimer(3000, b)・setTimer(1000, a) → jump(10000) | a・b の順。どちらも復帰後の時刻（+10000）で呼ぶ | B15-F, B16-F, B18-T | なし | なし（DEV-17 は繰り返しのタイマーだけ） |  | TC-UT_CLK-021 jump で取りこぼした1回だけのタイマーは、期限の順に復帰後の時刻で呼ぶ |  |
| TC-UT_CLK-022 | FakeClock.advance | 正常系 | 分岐網羅 | advance の中でタイマーが張ったタイマーは、目標の時刻までなら同じ advance で呼び、それより後なら呼ばない | FakeClock 2026-10-20T23:58:00.000Z | setTimer(1000, 中で setTimer(500, x) と setTimer(5000, y)) → advance(2000) | x は 1500 で呼ぶ。y は呼ばない（pendingCount 1）。時刻は +2000 | B13-T, B13-F, B18-T | なし | 一部 TC-NOUS45_DEV-15（sleep の連続だけ。目標の時刻を超える側は見ていない） |  | TC-UT_CLK-022 advance の中でタイマーが張ったタイマーは、目標の時刻までなら同じ advance で呼び、それより後なら呼ばない |  |
| TC-UT_CLK-023 | FakeClock.sleep | 正常系 | 分岐網羅 | 解決した後の sleep の signal を abort しても、何も起きない | FakeClock 2026-10-20T23:58:00.000Z | sleep(1000, signal) → advance(1000) → abort() | 解決のまま（拒否されない）。pendingCount 0 | B9-F, B10-F, B13-T, B18-T | なし | なし |  | TC-UT_CLK-023 解決した後の sleep の signal を abort しても、何も起きない |  |
| TC-UT_CLK-024 | FakeClock.advanceTo | 正常系 | 分岐網羅 | advanceTo は時刻をエポックからの ms（数値）でも受け取る | FakeClock 2026-10-20T23:58:00.000Z | advanceTo(Date.UTC(2026, 9, 21)) | 時刻が 2026-10-21T00:00:00.000Z | B14-T, B12-F | なし | なし（DEV-18 は Date だけ） |  | TC-UT_CLK-024 advanceTo は時刻をエポックからの ms（数値）でも受け取る |  |
| TC-UT_CLK-025 | FakeClock.advanceTo | 異常系 | エラー処理 | advanceTo に今より前の時刻を渡すと RangeError で、時刻は変わらない | FakeClock 2026-10-20T23:58:00.000Z | advanceTo(2026-10-20T23:57:59.999Z) | RangeError。時刻は変わらない | B14-F, B12-T | なし | なし（DEV-18 は advance(-1)） |  | TC-UT_CLK-025 advanceTo に今より前の時刻を渡すと RangeError で、時刻は変わらない |  |
| TC-UT_CLK-026 | SystemClock.sleep | 異常系 | 分岐網羅 | abort 済みの signal なら sleep はすぐ拒否し、タイマーを張らない | vi.useFakeTimers | abort 済みの signal で sleep(1000) | CancelledError で拒否。vi.getTimerCount() は 0 | B6-T | setTimeout（vi.useFakeTimers） | なし（DEV-20 は待ちの途中の abort） |  | TC-UT_CLK-026 abort 済みの signal なら sleep はすぐ拒否し、タイマーを張らない |  |
| TC-UT_CLK-027 | SystemClock.sleep | 正常系 | 分岐網羅 | 解決した後に signal を abort しても拒否にならず、タイマーも残らない | vi.useFakeTimers | sleep(1000, signal) → 1000 進める → abort() | 解決のまま。vi.getTimerCount() は 0 | B6-F, B7-F | setTimeout（vi.useFakeTimers） | なし |  | TC-UT_CLK-027 解決した後に signal を abort しても拒否にならず、タイマーも残らない |  |
| TC-UT_CLK-028 | SystemClock.setTimer | 正常系 | 分岐網羅 | 期限の前に解除した setTimer は呼ばない | vi.useFakeTimers | setTimer(1000) → 解除 → 2000 進める | callback を呼ばない |  | setTimeout（vi.useFakeTimers） | 一部 TC-NOUS45_DEV-21（解除するのは繰り返しのタイマーだけ） |  | TC-UT_CLK-028 期限の前に解除した setTimer は呼ばない |  |

## 3. 確認事項・バグの疑い

- 確認事項 1：README 6.2 は「サーバーのコードには vi.useFakeTimers() を使わない」としているが、SystemClock は setTimeout・setInterval をそのまま包む実装で、FakeClock では差し替えられない。SystemClock の行（TC-UT_CLK-026〜028）だけは、実装時のテスト（TC-NOUS45_DEV-19〜21）と同じく vi.useFakeTimers() を使い、afterEach で vi.useRealTimers() に戻す。
- 確認事項 2：SystemClock.setTimer・sleep は setTimeout をそのまま使うため、2^31-1 ms（約 24.8 日）を超える値を渡すと Node が 1 ms に丸めて即時に発火する。今の呼び出し（onUtcMidnight は最大 1 日、Scheduler の周期の待ち、再試行の 30・120 秒）はどれもこの範囲に収まるので、バグの疑いではなく確認事項とする。単体テストのケースは作らない（vi.useFakeTimers では Node の丸めを再現できないため）。
- 確認事項 3：B5（onUtcMidnight の cancelled）は、FakeClock・SystemClock とも解除したタイマーを呼ばないため、本物の Clock では通らない守りの分岐。TC-UT_CLK-009 で Clock を差し替えて真を通す。
