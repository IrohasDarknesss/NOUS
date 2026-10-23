# NOUS 単体テストの型と進め方

| 項目 | 内容 |
|---|---|
| 文書番号 | DD-NOUS-UT-00 |
| 版数 | v1.1 |
| 作成日 | 2026-10-23 |
| 作成者 | Jane Doe（テスト担当） |
| レビュー担当 | Kouhei Tajima（再鑑担当） |
| 対象 | 単体テストのケース作成（NOUS-90〜107）と、その後の実施のチケット |
| 関連チケット | NOUS-88（エピック）、NOUS-89 |

## 改訂履歴

| 版数 | 日付 | 変更内容 | 変更者 |
|---|---|---|---|
| v1 | 2026-10-23 | 初版作成 | Jane Doe |
| v1.1 | 2026-10-23 | 6.2 に SystemClock のテストだけ vi.useFakeTimers を使ってよいことを追記（NOUS-96 の確認事項） | Jane Doe |

---

## 1. 目的と範囲

単体テスト（UT）のケース作成を、Jane Doe・Mark Zuckerberg・Takaya Ishikawa の3名が同じ型でそろえて進めるための決まりを定める。決めるのは、観点表の列と ID、置き場所とファイル名、テストコードの置き方と命名、時計・固定応答・一時 DB の使い方、カバレッジの扱いの5つである。

- ケース作成のチケット（NOUS-90〜107）では、観点表とテストコードを作るところまでを行う。テストの実行・結果の記録・バグの起票は、実施のチケットで行う。
- 観点は、そのコードを実装していない人が作る（NOUS-88 の方針）。
- プロダクトのコード（`src` のうちテスト以外）は直さない。バグらしいものは観点表の「バグの疑い」に残し、チケットにコメントする。
- 結合テスト（IT）の観点は `docs/design/detailed/test/結合テスト観点表.md` にあり、本書の対象ではない。UT は関数・モジュールの単位で、IT は受入基準の単位で見る。

## 2. 1件のチケットの進め方

| 順 | 作業 | 成果物 |
|---|---|---|
| 1 | `git clone ~/project/nous-origin.git ~/project/wt/NOUS-xx` で clone し、`origin/develop` から `feature/NOUS-xx` を切る。NOUS-89 がまだ develop に入っていなければ、`origin/feature/NOUS-89` を取り込み、取り込んだコミットをチケットに書く（運用ルール 6章 3） | 作業用の clone |
| 2 | 対象のソースと、実装チケットの説明に書かれた設計書を読む。分岐（if・三項・早期 return・try/catch・ループ・`&&` `\|\|` `??`）と外部依存を洗い出す | 観点表の「分岐の一覧」 |
| 3 | 実装のときに書かれたテスト（`TC-NOUSxx_DEV-nn`）を読み、観点表に1件ずつ「開発者テスト」として載せる | 観点表の DEV の行 |
| 4 | test-case-generator スキルの技法（正常系・異常系・同値分割・境界値・分岐網羅・モック方針）で、DEV の行で足りない観点を足す | 観点表の UT の行 |
| 5 | 観点表の JSON を書き、`docs/test/unit/_build/build_matrix.py` で Markdown と Excel を作る | `観点表_<対象>.json / .md / .xlsx` |
| 6 | 足した観点のテストコードを書く（6章） | `<対象>.ut.test.ts(x)` |
| 7 | `pnpm typecheck` と `pnpm lint` を通し、commit・push する（9章） | `feature/NOUS-xx` |
| 8 | チケットに件数・ブランチ・コミット・疑いを書き、「再鑑」に移して担当を Kouhei Tajima にする | Jira のコメント |

- Mark Zuckerberg・Takaya Ishikawa の最初の1件は、手順 5 が終わった時点で、そのチケットで `@bot` をメンションして観点表の確認を頼む。Jane Doe が見て返事をしてから、手順 6 以降に進む（型のずれを早めに直すため）。2件目からは確認を待たずに進めてよい。
- つまずいたら、そのチケットで `@bot` をメンションする。

## 3. 観点表の列

観点表は JSON を正とし、Markdown と Excel はスクリプトで作る。列は次のとおりとする。test-case-generator スキルの形式に、NOUS で足した3列（前提・既存テストとの対応・バグの疑い）を加えている。Excel では、前提は「入力・前提条件」の列に、既存テストとの対応とバグの疑いは「備考」の列にまとめて載る。

### 3.1 観点表の先頭

| JSON のキー | 内容 | 書き方 |
|---|---|---|
| title | 観点表の名前 | 「ページ送りのカーソル（lib/cursor.ts）」のように、何のファイルかがわかる名前 |
| ticket | 関連チケット | NOUS-xx |
| author | 作成者 | Jira の表示名と役割（例：Takaya Ishikawa（開発担当））。ロール名（DDCT など）は書かない |
| created_on | 作成日 | YYYY-MM-DD |
| targets | 対象のファイル | リポジトリの直下からのパスの配列 |
| framework | 言語とフレームワーク | 「TypeScript / Vitest 2.1.9（environment: node）」。画面は「environment: jsdom、Testing Library」 |
| test_files | テストのファイル | 実装時のテスト（DEV）と、足したテスト（UT）の両方 |
| dependencies | 外部依存 | DB・時計・LLM・fetch・乱数・環境変数など。なければ「なし」 |
| design_refs | 入力にした設計書 | 設計書の名前と章 |
| branches | 分岐の一覧 | `{ id: "B1", condition: "…", location: "ファイル:行" }`。ID はファイルの中で B1 から振る |
| issues | 確認事項・バグの疑い | 文の配列。「確認事項 n：」「疑い n：」で始める |

### 3.2 ケースの列

| JSON のキー | 列の名前 | 書き方 |
|---|---|---|
| id | ID | 4章のとおり |
| target | 対象 | 関数・コンポーネント・API の名前（例：decodeCursor、`GET /admin/api/audit-logs`、AgentListPage） |
| category | 分類 | `正常系` か `異常系` のどちらか |
| technique | 観点の種類 | `同値分割`・`境界値`・`分岐網羅`・`エラー処理`・`依存`（モックした依存の失敗・呼び出しの確認）・`状態遷移`・`開発者テスト`（DEV の行だけ）のどれか |
| viewpoint | 観点 | 何を確かめるかを1文で。1行に無効な値は1種類だけにする |
| precondition | 前提 | DB に入れておくデータ、時計の時刻、世界の状態、ログインの有無など。なければ「なし」 |
| input | 入力 | 引数・リクエスト・画面の操作の具体値 |
| expected | 期待結果 | 戻り値・例外（code・status・fields）・DB の変化・画面の表示。設計書の「あるべき仕様」で書く（7章） |
| branches | 分岐 | 通る分岐を `B1-T`（真）`B1-F`（偽）で。分岐のない関数は空の配列 |
| mock | モック | 差し替えた依存と、その振る舞い（例：FakeClock 2026-10-22T23:59:59Z、固定応答 failures、fetch → 500）。なければ「なし」 |
| dev_ref | 既存テストとの対応 | UT の行：重なる DEV のテストの ID と、足りない点（例：「一部 TC-NOUS56_DEV-02（数値の要素だけ）」）。重ならなければ「なし（理由）」。DEV の行：「実装時のテスト（NOUS-xx）」 |
| suspect | バグの疑い | 期待結果と実装が食い違うと思われるとき、その内容。なければ空 |
| test_name | テスト名 | テストコードの `it` の名前と完全に同じにする（ID で始める） |
| result | 実施結果 | ケース作成では空のまま。実施のチケットで collect_results.py が入れる |
| note | 備考 | 期待値の根拠が設計書にないとき、その旨など |
| data | テストデータ | 任意。test-case-generator の形式（values・expected・mocks・ref）。値が長いケースや、フィクスチャのファイルを使うケースで書く |

## 4. ケースの ID

- 単体テストで足すケースは `TC-UT_<領域>-nnn` とする（例：`TC-UT_LIB-001`）。nnn は3桁の連番で、領域ごとに 001 から振る。
- 実装のときに書かれたテストは、付いている ID（`TC-NOUS56_DEV-01` など）をそのまま観点表の ID にする。付け直さない。
- `UT-` ではなく `TC-` で始めるのは、test-case-generator の集計（collect_results.py）が `TC-<英数字と _>-<数字>` の形しか拾わないため。`TC-UT-LIB-001` のように途中にハイフンを足すと、集計から漏れる。
- 一度使った番号は、ケースを消しても使い回さない（欠番にする）。
- 領域のコードは次のとおりとする。チケットの中で足りなければ、英大文字3〜5字で足し、チケットのコメントに書く。

| チケット | 担当 | 領域のコード |
|---|---|---|
| NOUS-90 | Jane Doe | LIB（apps/server/src/lib）、SHR（packages/shared）。cursor.ts は見本で LIB-001〜010 を使ったので、LIB は 011 から振る |
| NOUS-91 | Jane Doe | ADM（adminServer・context・middleware）、AUTH（auth・cli） |
| NOUS-92 | Jane Doe | INV（invitations）、AUD（audit） |
| NOUS-93 | Jane Doe | AGT（agents）、ADATA（data）、GENQ（generations）、MET（metrics）、ARC（worlds） |
| NOUS-94 | Jane Doe | DB |
| NOUS-95 | Jane Doe | P203、P204 |
| NOUS-96 | Mark Zuckerberg | CLK（clock）、LLM（llm） |
| NOUS-97 | Mark Zuckerberg | WLD（world） |
| NOUS-98 | Mark Zuckerberg | SCH（scheduler）、BOOT（main.ts・index.ts） |
| NOUS-99 | Mark Zuckerberg | AWEB（api・layout・shared・session・router・main・App）、P201、P202、P205 |
| NOUS-100 | Mark Zuckerberg | MOD（moderation） |
| NOUS-101 | Mark Zuckerberg | P209、P210、P211 |
| NOUS-102 | Takaya Ishikawa | CFG（config）、GATE（gate）、CAND（candidates・rng）、CTX（contextLoader）、PRM（promptBuilder・tokenEstimator） |
| NOUS-103 | Takaya Ishikawa | OUT（outputParser）、VAL（actionValidator）、APL（actionApplier）、MEM（memoryUpdater）、CON（consistencyChecker） |
| NOUS-104 | Takaya Ishikawa | RUN（opportunityRunner）、RTY（retryPolicy）、USG（usageRecorder） |
| NOUS-105 | Takaya Ishikawa | OBS（observer） |
| NOUS-106 | Takaya Ishikawa | OWEB（画面の共通・api・hooks・lib）、P101〜P106 |
| NOUS-107 | Takaya Ishikawa | P206、P207、P208 |

## 5. 置き場所とファイル名

| 物 | 置き場所 | ファイル名 |
|---|---|---|
| 観点表（正） | `docs/test/unit/<チケットのキー>/` | `観点表_<対象>.json`（対象はファイル名かモジュール名。例：`観点表_cursor.json`、`観点表_auth.json`、`観点表_P203.json`） |
| 観点表（読む用） | 同じ | `観点表_<対象>.md`、`観点表_<対象>.xlsx`（スクリプトで作る。手で直さない） |
| テストコード | 対象のソースと同じディレクトリ | 6章 |
| テスト結果のレポート | 実施のチケットに添付する | リポジトリには置かない |

- 1件のチケットで観点表を何枚に分けてもよい。目安は、ソースのファイル1〜3本で1枚、ケースが 60 件を超えたら分ける。
- Markdown と Excel は次で作る。JSON を直したら、そのつど作り直して一緒に commit する。

```bash
python3 docs/test/unit/_build/build_matrix.py docs/test/unit/NOUS-xx/観点表_<対象>.json
```

- Excel の書き出しには openpyxl が要る。初めてのときは、リポジトリの外に一度だけ作る（作ってあればそのまま使う）。

```bash
[ -x ~/project/.venv-test/bin/python ] || (python3 -m venv ~/project/.venv-test && ~/project/.venv-test/bin/pip install openpyxl)
```

- `docs/` は eslint と prettier の対象外なので、観点表の JSON の書式は lint に影響しない。JSON はスペース2つのインデントで書く。

## 6. テストコード

### 6.1 置き方と命名

- 単体テストで足すテストは、対象のソースと同じディレクトリに `<対象>.ut.test.ts`（画面は `.ut.test.tsx`）として新しく作る。各パッケージの vitest の `include`（`src/**/*.test.ts` など）にそのまま入り、`tsc` の型チェックの対象にもなる。
- 実装のときのテスト（`<対象>.test.ts`）は直さない。内容の誤りに気づいたら、観点表の「バグの疑い」か issues に書き、チケットにコメントする。DEV のテストと UT のテストをファイルで分けるのは、ケースの出どころを分けて追えるようにするためと、並行するチケットの間で同じファイルを触らないためである。
- 1つのソースに対して `.ut.test.ts` は1本とする。対象のディレクトリにまとめてテストを置く流儀（例：`components.test.tsx`、`observer.test.ts`）のところは、それに合わせて `components.ut.test.tsx` のようにまとめてよい。
- ファイルの先頭に、観点表の場所を1行のコメントで書く（例：`// 単体テスト（NOUS-90）。観点表は docs/test/unit/NOUS-90/観点表_ids.json`）。
- `describe` の名前は「<対象>（単体テスト）」とする。
- `it` の名前は `TC-UT_<領域>-nnn <観点>` とし、観点表の test_name と完全に同じにする。1件のテストに ID は1つだけ入れる。
- 入力だけが違うケースは `it.each` にしてよい。そのときは、全部の行の名前に同じ ID が入るようにし（`"TC-UT_LIB-006 …（%j）"`）、観点表では1件として数える。観点表の test_name には、末尾の（%j）を除いた部分を書く。別の観点なら、別の ID にする。
- テストの中は「準備・実行・確認」の順に書き、間を1行空ける。
- import は既存のテストに合わせ、`vitest` から `describe`・`expect`・`it` など使うものだけを名前で取り込む。

### 6.2 時計（FakeClock）

- 時刻を使う処理には、`apps/server/src/clock/fakeClock.ts` の `FakeClock` を渡す。`Date.now()`・`new Date()` に頼った期待値や、実時間の待ち（`setTimeout` で待つ、`sleep` を実際に待つ）は書かない。
- 開始時刻は、テストの中で固定の値を渡す（例：`new FakeClock(new Date("2026-10-22T09:00:00.000Z"))`）。`new FakeClock()` のように引数なしで作らない（実行した時刻になってしまうため）。
- 時刻を進めるときは `await clock.advance(ms)` か `await clock.advanceTo(時刻)` を使う。スリープからの復帰（B08）を見るときは `await clock.jump(ms)` を使う。どれも `await` を忘れない。
- 00:00 UTC の日の区切りは、23:59:59.999 と 00:00:00.000 の両側を境界値として入れる。
- サーバーのコードには `vi.useFakeTimers()` を使わない（Clock を差し替える作りなので、二重になる）。ただし、Clock の実装そのもの（`clock/clock.ts` の SystemClock）のテストだけは、包んでいる `setTimeout`・`setInterval` を差し替えるために `vi.useFakeTimers()` を使ってよい（NOUS-96 で確認）。画面（admin・observer）のコードで、ポーリングなどの `setTimeout`・`setInterval` を見るときだけ `vi.useFakeTimers()` を使い、`afterEach` で `vi.useRealTimers()` に戻す。
- 管理サーバーのテストは、`apps/server/test/helpers/adminTestSupport.ts` の `testDeps(db)`（FakeClock 付き、時刻は TEST_NOW）と `captureLogger()` を使ってよい。

### 6.3 LLM の固定応答（fixedClient）

- テストから Cloudflare へは通信しない。`apps/server/src/llm/cloudflareClient.ts` を見るときは、`fetch` を差し替える（既存の cloudflareClient.test.ts に合わせる）。
- LlmClient を使う処理（行動生成など）は、次のどちらかで依存を切る。
  - 応答の中身だけが要るとき：テストの中で `LlmClient` を満たす小さな差し替えを書き、返す値と呼ばれた回数・引数を確かめる。
  - 固定応答の読み込み・遅延・失敗の再現まで含めて見るとき：`createFixedClient({ fixtureDir, scenario, clock })` を使う。`clock` には FakeClock を渡し、`delayMs` を実時間で待たない。
- `fixtures/llm/` の既存のシナリオ（basic・failures など）は結合テストと共用なので、読むだけにして書き換えない。単体テストだけで使う応答が要るときは、`mkdtemp` で作った一時ディレクトリに `<シナリオ>/<ハンドル>-<巡の番号>.json` を書き、`fixtureDir` にそのディレクトリを渡す（既存の fixedClient.test.ts と同じ）。テストが終わったら消す。
- 乱数は `createRng(seed, salt)` の種を固定する。`Math.random()` に頼った期待値は書かない。

### 6.4 一時 DB

- DB を使うテストは、`apps/server/test/helpers/testDb.ts` の `createTestDb()` を使う。一時ディレクトリにファイルの DB を作り、マイグレーションを当てた状態で返す。
- テストごとに作り直す。`beforeEach` で `createTestDb()`、`afterEach` で `cleanup()` を呼ぶ。テストの間でデータを持ち越さない。
- `data/dev.db` などリポジトリの中の DB と、`:memory:` は使わない（本番と同じ WAL・外部キーの設定で確かめるため）。
- 前提のデータは、`apps/server/test/helpers/generationSeed.ts`（世界・エージェント・生成イベント）と `adminTestSupport.ts`（管理者・セッション）の関数で入れてよい。足りないものは、そのテストのファイルの中で drizzle の insert で入れる。helpers に関数を足したいときは、ほかのチケットと競合しないよう、チケットで `@bot` に相談してから足す。
- DB の変化を確かめるときは、戻り値だけでなく、テーブルを読み直して件数と値を確かめる。

### 6.5 画面のテスト

- admin・observer は jsdom と Testing Library で、既存のテストに合わせる。API は `apps/admin/src/test/fetchMock.ts` の `mockFetch` で差し替え、管理画面の描画には `apps/admin/src/test/renderApp.tsx` を使ってよい。
- 見た目（色・余白・崩れ）は単体テストの対象にしない（ST の UI レビューで見る）。表示する文言・項目・ボタンの有効と無効・入力の検証・API の呼び方・エラーの表示を見る。

## 7. 期待結果とバグの疑い

- 期待結果は、設計書・要件定義書に書かれた「あるべき仕様」で書く。実装を動かして得た値をそのまま期待値にしない。
- 設計書から読み取れないときは、実装の値を期待値にしてよいが、備考に「設計書に記載なし。実装の値」と書く。仕様として決めてほしいものは issues の「確認事項」に書き、チケットで `@saikan` に確認する。
- 実装が仕様と食い違うと思われるときは、テストは仕様どおりの期待結果で書き（実施のときに NG になる）、観点表の「バグの疑い」と issues の「疑い n：」に内容を書き、チケットのコメントにも書く。プロダクトのコードは直さない。バグの起票は実施のチケットで行う。
- `it.skip`・`it.todo`・`it.fails` で、落ちるテストを隠さない。

## 8. カバレッジ

- 現時点では、カバレッジの道具では測らない。`@vitest/coverage-v8` は入っておらず、依存の追加は Kouhei Tajima の判断が要る（運用ルール 6章 4）。
- 代わりに、観点表の「分岐の一覧」と各ケースの「分岐」で、すべての分岐の真と偽を1回以上通すこと（C1）を人の目で確かめる。通らない分岐が残るときは、その理由を issues に書く。
- 道具で測るかどうかは NOUS-89 で Kouhei Tajima に判断を仰いでいる。決まったら本書を改訂し、実施のチケットから測る。

## 9. commit・push とチケットへの書き込み

- commit の前に、リポジトリの直下で次を通す。

```bash
export PATH=/opt/homebrew/opt/node@22/bin:$PATH
pnpm exec prettier --write <足したテストのファイル>
pnpm typecheck
pnpm lint
```

- テストを流して確かめるのは任意とする（実行と結果の記録は実施のチケットで行う）。流す場合も、結果は観点表に書かない。
- commit のメッセージは `NOUS-xx: 単体テストの観点表とテストコード（<対象>、UT n 件）` の形にする。作成者は Jira の表示名にする（例：`git -c user.name="Takaya Ishikawa" -c user.email=dev2-agent@localhost commit ...`）。
- push するのは `feature/NOUS-xx` だけとする。main・develop には push しない。
- チケットのコメントには、観点表の件数（DEV の行・UT の行、うち新しくテストコードを足した件数）、バグの疑いと確認事項の件数と要点、ブランチ、コミットを書く。そのうえで「再鑑」に移し、担当を Kouhei Tajima にする。

## 10. 見本

`lib/cursor.ts` の観点表とテストコードを見本として置く。DEV の2件と UT の10件（正常系3件・異常系7件）で、分岐 B1〜B5 の真と偽をすべて通している。

| 物 | 場所 |
|---|---|
| 観点表 | `docs/test/unit/NOUS-89/観点表_cursor.json`（`.md`・`.xlsx`） |
| テストコード | `apps/server/src/lib/cursor.ut.test.ts` |
| 実装時のテスト | `apps/server/src/lib/cursor.test.ts`（TC-NOUS56_DEV-01・02） |
