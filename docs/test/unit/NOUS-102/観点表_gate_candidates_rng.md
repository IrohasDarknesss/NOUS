# 単体テスト観点表：参加の判定・候補の抽選・乱数（generation/gate.ts・candidates.ts・rng.ts）

| 項目 | 内容 |
|---|---|
| 関連チケット | NOUS-102 |
| 作成者 | Takaya Ishikawa（開発担当） |
| 作成日 | 2026-10-23 |
| 対象 | apps/server/src/generation/gate.ts, apps/server/src/generation/candidates.ts, apps/server/src/generation/rng.ts |
| 言語 / フレームワーク | TypeScript / Vitest 2.1.9（environment: node） |
| テストファイル | apps/server/src/generation/gate.test.ts・candidates.test.ts（実装時、NOUS-61）, apps/server/src/generation/rng.test.ts（実装時、NOUS-48）, apps/server/src/generation/gate.ut.test.ts・candidates.ut.test.ts・rng.ut.test.ts（単体テストで追加） |
| 外部依存 | 乱数（createRng。種を固定する。drawCandidates は乱数の関数を引数で受けるので、固定の値を返す関数に差し替える） |
| 入力にした設計書 | BE 詳細設計 generation 4章 decideParticipation・createRng・drawCandidates・availableActions, 行動生成とプロンプトの設計 3章・4章 |

このファイルは `docs/test/unit/_build/build_matrix.py` で JSON から作る。直すときは JSON を直して作り直す。

## 1. 分岐の一覧

| ID | 条件 | 場所 |
|---|---|---|
| B1 | !Number.isInteger(activityLevel) | gate.ts:15 |
| B2 | !(String(activityLevel) in config.participation) | gate.ts:15 |
| B3 | rng() < p（参加する） | gate.ts:27 |
| B4 | refs.length > 0（reply を加える） | candidates.ts:27 |
| B5 | likeable.length > 0（like を加える） | candidates.ts:28 |
| B6 | followTargets.length > 0（follow を加える） | candidates.ts:29 |
| B7 | followees.length > 0（unfollow を加える） | candidates.ts:30 |
| B8 | !available.includes(kind)（選べない種類を飛ばす） | candidates.ts:42 |
| B9 | w > 0（重み 0 の種類を抽選から除く） | candidates.ts:59 |
| B10 | picked.length < candidateCount && pool.length > 0（抽選を続ける） | candidates.ts:61 |
| B11 | r < cumulative（区間に入った。偽のまま終われば末尾の種類） | candidates.ts:68 |
| B12 | picked.length > 0（偽なら ['post']） | candidates.ts:76 |
| B13 | for (const byte of …)（UTF-8 のバイトが 1 つ以上ある） | rng.ts:10 |

## 2. ケースの一覧（46 件。うち新しく足したもの 21 件）

| ID | 対象 | 分類 | 技法 | 観点 | 前提 | 入力 | 期待結果 | 分岐 | モック | 既存テストとの対応 | バグの疑い | テスト名 | 備考 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| TC-NOUS48_DEV-01 | createRng | 正常系 | 開発者テスト | 同じ種と salt からは同じ乱数列が出る | なし | 同じ種・同じ salt で 2 つ作る | 列が等しい | B13-T | なし | 実装時のテスト（NOUS-48） |  | TC-NOUS48_DEV-01 同じ種と salt からは同じ乱数列が出る |  |
| TC-NOUS48_DEV-02 | createRng | 正常系 | 開発者テスト | salt が違えば乱数列が変わる | なし | 同じ種・違う salt | 列が違う | B13-T | なし | 実装時のテスト（NOUS-48） |  | TC-NOUS48_DEV-02 salt が違えば乱数列が変わる |  |
| TC-NOUS48_DEV-03 | createRng | 正常系 | 開発者テスト | 種が違えば乱数列が変わる | なし | 違う種・同じ salt | 列が違う | B13-T | なし | 実装時のテスト（NOUS-48） |  | TC-NOUS48_DEV-03 種が違えば乱数列が変わる |  |
| TC-NOUS48_DEV-04 | createRng | 正常系 | 開発者テスト | 値はいつも 0 以上 1 未満 | なし | 多数の値 | 0 以上 1 未満 | B13-T | なし | 実装時のテスト（NOUS-48） |  | TC-NOUS48_DEV-04 値はいつも 0 以上 1 未満 |  |
| TC-NOUS48_DEV-05 | mulberry32 | 正常系 | 開発者テスト | mulberry32 は既知の値を返す（種 1） | なし | mulberry32(1) の 3 つ | 既知の 3 つの値 |  | なし | 実装時のテスト（NOUS-48） |  | TC-NOUS48_DEV-05 mulberry32 は既知の値を返す（種 1） |  |
| TC-NOUS48_DEV-06 | fnv1a32 | 正常系 | 開発者テスト | FNV-1a は既知の値を返す | なし | ""、"a" | 0x811c9dc5、0xe40c292c | B13-T, B13-F | なし | 実装時のテスト（NOUS-48） |  | TC-NOUS48_DEV-06 FNV-1a は既知の値を返す |  |
| TC-NOUS48_DEV-07 | createRng | 正常系 | 開発者テスト | createRng は salt のハッシュと種の XOR を mulberry32 に渡す | なし | 種 12345、salt "01J0AGENT" | mulberry32((12345 ^ fnv1a32(salt)) >>> 0) と同じ列、既知の値 | B13-T | なし | 実装時のテスト（NOUS-48） |  | TC-NOUS48_DEV-07 createRng は salt のハッシュと種の XOR を mulberry32 に渡す |  |
| TC-NOUS61_DEV-01 | participationProbability | 正常系 | 開発者テスト | 活動頻度に対応する参加の確率を返す | なし | 活動頻度 1〜5 | 0.3、0.45、0.6、0.75、0.9 | B1-F, B2-F | なし | 実装時のテスト（NOUS-61） |  | TC-NOUS61_DEV-01 活動頻度に対応する参加の確率を返す |  |
| TC-NOUS61_DEV-02 | participationProbability | 異常系 | 開発者テスト | 活動頻度が 1〜5 の整数でなければ RangeError | なし | 0、6、2.5、NaN（it.each） | RangeError | B1-T, B2-T | なし | 実装時のテスト（NOUS-61） |  | TC-NOUS61_DEV-02 活動頻度が 1〜5 の整数でなければ RangeError |  |
| TC-NOUS61_DEV-03 | decideParticipation | 正常系 | 開発者テスト | 同じ種とエージェントなら同じ判定になる | なし | 種 0〜49、同じエージェント | 2 回の判定が等しい | B3-T, B3-F | なし | 実装時のテスト（NOUS-61） |  | TC-NOUS61_DEV-03 同じ種とエージェントなら同じ判定になる |  |
| TC-NOUS61_DEV-04 | decideParticipation | 正常系 | 開発者テスト | 判定は createRng(seed, agent_id) の最初の値 < 確率 | なし | 種 0〜49、活動頻度 4 | createRng の最初の値 < 0.75 と一致 | B3-T, B3-F | なし | 実装時のテスト（NOUS-61） |  | TC-NOUS61_DEV-04 判定は createRng(seed, agent_id) の最初の値 < 確率 |  |
| TC-NOUS61_DEV-05 | decideParticipation | 正常系 | 開発者テスト | 確率 0 なら参加せず、確率 1 なら必ず参加する | なし | 確率 0 と 1 の設定、種 0〜99 | 0 は常に false、1 は常に true | B3-T, B3-F | なし | 実装時のテスト（NOUS-61） |  | TC-NOUS61_DEV-05 確率 0 なら参加せず、確率 1 なら必ず参加する |  |
| TC-NOUS61_DEV-06 | decideParticipation | 正常系 | 開発者テスト | 多数の種で、参加の割合が確率に近い | なし | 種 0〜4999、活動頻度 3 | 参加の割合が 0.55〜0.65 | B3-T, B3-F | なし | 実装時のテスト（NOUS-61） |  | TC-NOUS61_DEV-06 多数の種で、参加の割合が確率に近い |  |
| TC-NOUS61_DEV-11 | availableActions | 正常系 | 開発者テスト | 何もなければ post だけ | なし | すべて空 | ['post'] | B4-F, B5-F, B6-F, B7-F | なし | 実装時のテスト（NOUS-61） |  | TC-NOUS61_DEV-11 何もなければ post だけ |  |
| TC-NOUS61_DEV-12 | availableActions | 正常系 | 開発者テスト | 条件ごとに reply・like・follow・unfollow が加わる | なし | それぞれの条件を満たす値 | 条件に応じた種類が加わる | B4-T, B5-T, B6-T, B7-T | なし | 実装時のテスト（NOUS-61） |  | TC-NOUS61_DEV-12 条件ごとに reply・like・follow・unfollow が加わる |  |
| TC-NOUS61_DEV-13 | drawCandidates | 正常系 | 開発者テスト | 既定では候補を 2 つ、重複なしに選ぶ | なし | 種 0〜199、5 種類 | 2 つ、重複なし | B9-T, B10-T, B10-F, B11-T, B12-T | なし | 実装時のテスト（NOUS-61） |  | TC-NOUS61_DEV-13 既定では候補を 2 つ、重複なしに選ぶ |  |
| TC-NOUS61_DEV-14 | drawCandidates | 正常系 | 開発者テスト | 候補の数は config.candidateCount に従う（2〜4） | なし | candidateCount 2・3・4 | その数だけ返す | B10-T, B10-F | なし | 実装時のテスト（NOUS-61） |  | TC-NOUS61_DEV-14 候補の数は config.candidateCount に従う（2〜4） |  |
| TC-NOUS61_DEV-15 | drawCandidates | 正常系 | 開発者テスト | 選べる種類が候補の数より少なければ、その数だけ返す | なし | ['post']、['post','like'] で候補 4 | ['post']、{post, like} | B10-F | なし | 実装時のテスト（NOUS-61） |  | TC-NOUS61_DEV-15 選べる種類が候補の数より少なければ、その数だけ返す |  |
| TC-NOUS61_DEV-16 | drawCandidates | 異常系 | 開発者テスト | 選べる種類が無ければ ['post'] | なし | available=[] | ['post'] | B10-F, B12-F | なし | 実装時のテスト（NOUS-61） |  | TC-NOUS61_DEV-16 選べる種類が無ければ ['post'] |  |
| TC-NOUS61_DEV-17 | drawCandidates | 正常系 | 開発者テスト | 選べない種類は候補に入らない | なし | ['post','reply','like'] | その 3 種類のどれか | B8-T, B8-F | なし | 実装時のテスト（NOUS-61） |  | TC-NOUS61_DEV-17 選べない種類は候補に入らない |  |
| TC-NOUS61_DEV-18 | candidateWeights | 正常系 | 開発者テスト | 直近の行動に含まれるたびに重みを recentPenalty 倍にする | なし | recent=['post','post']、['like','reply'] | post 3×0.4×0.4、like 2.5×0.4、reply 3 | B8-F | なし | 実装時のテスト（NOUS-61） |  | TC-NOUS61_DEV-18 直近の行動に含まれるたびに重みを recentPenalty 倍にする |  |
| TC-NOUS61_DEV-19 | drawCandidates | 正常系 | 開発者テスト | 重みに比例して選ぶ（累積の区間で決まる） | なし | 固定の乱数 0、0.99、0.29 | post、unfollow、reply | B11-T, B11-F | なし | 実装時のテスト（NOUS-61） |  | TC-NOUS61_DEV-19 重みに比例して選ぶ（累積の区間で決まる） |  |
| TC-NOUS61_DEV-20 | drawCandidates | 正常系 | 開発者テスト | 重み 0 の種類は選ばない | なし | follow・unfollow の重み 0、候補 4 | follow・unfollow を含まない | B9-T, B9-F | なし | 実装時のテスト（NOUS-61） |  | TC-NOUS61_DEV-20 重み 0 の種類は選ばない |  |
| TC-NOUS61_DEV-21 | drawCandidates | 正常系 | 開発者テスト | 減点された種類は選ばれにくくなる | なし | 種 0〜2999、recent=['post','post'] と [] | post が選ばれる回数が減る | B11-T, B11-F | なし | 実装時のテスト（NOUS-61） |  | TC-NOUS61_DEV-21 減点された種類は選ばれにくくなる |  |
| TC-NOUS61_DEV-22 | createCandidateRng | 正常系 | 開発者テスト | 同じ種なら同じ候補になり、判定の乱数とは別の列を使う | なし | 種 42、agent | 同じ候補。最初の値が createRng(42, agent) と違う | B13-T | なし | 実装時のテスト（NOUS-61） |  | TC-NOUS61_DEV-22 同じ種なら同じ候補になり、判定の乱数とは別の列を使う |  |
| TC-UT_CAND-001 | createRng | 正常系 | 境界値 | salt が空の文字列なら、種とオフセット基底の XOR を mulberry32 に渡す | なし | 種 12345、salt "" | mulberry32((12345 ^ 0x811c9dc5) >>> 0) と同じ列 | B13-F | なし | 一部 TC-NOUS48_DEV-06（fnv1a32 の値だけ） |  | TC-UT_CAND-001 salt が空の文字列なら、種とオフセット基底（0x811c9dc5）の XOR を mulberry32 に渡す |  |
| TC-UT_CAND-002 | fnv1a32 | 正常系 | 同値分割 | FNV-1a は UTF-16 ではなく UTF-8 のバイト列にかける（多バイトの字） | なし | "あ"（E3 81 82） | バイト列に手でかけた値と等しい | B13-T | なし | なし（DEV-06 は ASCII だけ） |  | TC-UT_CAND-002 FNV-1a は UTF-8 のバイト列にかける（「あ」は E3 81 82 の 3 バイト） | エージェント ID は ULID（ASCII）だが、salt に日本語が入っても同じ値になることを確かめる |
| TC-UT_CAND-003 | createRng | 正常系 | 境界値 | 種の境界（0、0xFFFFFFFF、-1）でも 0 以上 1 未満の値を返す | なし | 種 0、0xFFFFFFFF、-1（it.each）、各 100 個 | すべて 0 以上 1 未満 | B13-T | なし | 一部 TC-NOUS48_DEV-04（種の境界は見ていない） |  | TC-UT_CAND-003 種の境界でも 0 以上 1 未満の値を返す | cycle_seed は 32 ビットの整数（world.md） |
| TC-UT_CAND-004 | createRng | 正常系 | 同値分割 | 種 -1 は 0xFFFFFFFF と同じ乱数列になる（32 ビットに丸める） | なし | 種 -1 と 0xFFFFFFFF | 最初の 3 つが等しい | B13-T | なし | なし |  | TC-UT_CAND-004 種 -1 は 0xFFFFFFFF と同じ乱数列になる（32 ビットに丸める） | 設計書に記載なし。実装の値（XOR で 32 ビットに丸める） |
| TC-UT_CAND-005 | createRng | 正常系 | 状態遷移 | 乱数の関数ごとに状態を持ち、別に作った関数の列に影響しない | なし | 同じ種・salt で a・b を作り、a を 3 回呼ぶ | b の最初の値は a の最初の値と等しい | B13-T | なし | なし |  | TC-UT_CAND-005 乱数の関数ごとに状態を持ち、別に作った関数の列に影響しない |  |
| TC-UT_GATE-001 | decideParticipation | 正常系 | 境界値 | 最初の乱数の値と確率が等しければ参加せず（< の境界）、わずかに上回れば参加する | なし | 種 12345、活動頻度 3、確率 = 最初の値 v と v + 1e-9 | v のとき false、v + 1e-9 のとき true | B1-F, B2-F, B3-T, B3-F | なし | 一部 TC-NOUS61_DEV-04（等しいときを見ていない） |  | TC-UT_GATE-001 最初の乱数の値と確率が等しければ参加せず、わずかに上回れば参加する |  |
| TC-UT_GATE-002 | decideParticipation | 正常系 | 同値分割 | 確率は config の値を使い、設定を変えれば判定が変わる（NFR-O-005） | なし | 活動頻度 2 の確率を v/2 と (v+1)/2 にした設定 | v/2 は false、(v+1)/2 は true。participationProbability は設定の値 | B3-T, B3-F | なし | 一部 TC-NOUS61_DEV-05（0 と 1 だけ） |  | TC-UT_GATE-002 確率は config の値を使い、設定を変えれば判定が変わる |  |
| TC-UT_GATE-003 | decideParticipation | 異常系 | 同値分割 | 活動頻度が範囲の外なら、decideParticipation も RangeError（乱数より先に止まる） | なし | Infinity、-1、1.0000001（it.each） | RangeError | B1-T, B2-T | なし | 一部 TC-NOUS61_DEV-02（participationProbability だけ） |  | TC-UT_GATE-003 活動頻度が 1〜5 の整数でなければ decideParticipation も RangeError |  |
| TC-UT_GATE-004 | decideParticipation | 正常系 | 同値分割 | エージェントが違えば、同じ種でも別の乱数で判定する（全員が同じ判定にならない） | なし | 種 2026、50 体、活動頻度 3 | 参加と不参加の両方が出る | B3-T, B3-F | なし | なし（DEV-03 は同じエージェントだけ） |  | TC-UT_GATE-004 エージェントが違えば、同じ種でも別の乱数で判定する |  |
| TC-UT_CAND-006 | availableActions | 正常系 | 境界値 | 条件がちょうど 1 件のとき、その種類だけが post に加わる | なし | 参照する投稿 1 件、いいねできる投稿 1 件、フォローできる住人 1 体、フォロー中 1 体（it.each） | ['post', その種類] | B4-T, B4-F, B5-T, B5-F, B6-T, B6-F, B7-T, B7-F | なし | 一部 TC-NOUS61_DEV-12（4 条件を同時に満たす値だけ） |  | TC-UT_CAND-006 条件がちょうど 1 件で、その種類だけが加わる |  |
| TC-UT_CAND-007 | drawCandidates | 正常系 | 境界値 | 減点 0 なら直近の行動の種類は重み 0 になり、候補に入らない | なし | recentPenalty=0、recent=['post']、種 0〜49 | post の重み 0、どの候補にも post が無い | B8-F, B9-F, B9-T | なし | なし |  | TC-UT_CAND-007 減点 0 なら直近の行動の種類は重み 0 になり、候補に入らない |  |
| TC-UT_CAND-008 | candidateWeights | 正常系 | 境界値 | 減点 1 なら直近の行動があっても重みは変わらない | なし | recentPenalty=1、recent=['post','post'] | post の重み 3 | B8-F | なし | なし |  | TC-UT_CAND-008 減点 1 なら直近の行動があっても重みは変わらない |  |
| TC-UT_CAND-009 | candidateWeights | 正常系 | 同値分割 | 直近の行動に選べない種類があっても、ほかの重みに影響しない | なし | available=['post']、recent=['follow','follow'] | [['post', 3]] だけ | B8-T, B8-F | なし | なし |  | TC-UT_CAND-009 直近の行動に選べない種類があっても、ほかの重みに影響しない |  |
| TC-UT_CAND-010 | drawCandidates | 異常系 | 同値分割 | 選べる種類に重複があっても、候補は重複しない | なし | available=['post','post','reply']、乱数 0 | ['post','reply'] | B8-F, B10-T, B11-T | なし | なし |  | TC-UT_CAND-010 選べる種類に重複があっても、候補は重複しない | 設計書に記載なし。重みを ACTION_KINDS の順に数えるので重複は 1 つになる（実装の値） |
| TC-UT_CAND-011 | drawCandidates | 正常系 | 境界値 | 乱数が 0 なら区間の先頭の種類を選ぶ | なし | 乱数 0 を返し続ける | ['post','reply'] | B10-T, B11-T | 乱数を固定の値を返す関数に差し替え | 一部 TC-NOUS61_DEV-19（1 つ目だけ） |  | TC-UT_CAND-011 乱数が 0 なら区間の先頭の種類を選ぶ |  |
| TC-UT_CAND-012 | drawCandidates | 正常系 | 境界値 | 乱数が 1 に近ければ区間の末尾の種類を選ぶ（2 つ目は残りの末尾） | なし | 乱数 0.9999999999 を返し続ける | ['unfollow','follow'] | B10-T, B11-T, B11-F | 乱数を固定の値を返す関数に差し替え | 一部 TC-NOUS61_DEV-19（1 つ目だけ） |  | TC-UT_CAND-012 乱数が 1 に近ければ区間の末尾の種類を選ぶ |  |
| TC-UT_CAND-013 | drawCandidates | 正常系 | 境界値 | 候補の数 4 で 5 種類が選べるとき、4 つを重複なしに選ぶ | なし | candidateCount=4、種 0〜29 | どれも 4 つで重複なし | B10-T, B10-F | なし | 一部 TC-NOUS61_DEV-14（件数だけ、種 1 だけ） |  | TC-UT_CAND-013 候補の数 4 で 5 種類が選べるとき、4 つを重複なしに選ぶ |  |
| TC-UT_CAND-014 | drawCandidates | 異常系 | 分岐網羅 | すべての重みが 0 なら ['post'] を返す | なし | weights すべて 0 | ['post'] | B9-F, B10-F, B12-F | なし | 一部 TC-NOUS61_DEV-16（available が空のときだけ） |  | TC-UT_CAND-014 すべての重みが 0 なら ['post'] を返す | 設計書は available が空のときだけ ['post'] と書く。重みがすべて 0 のときは記載なし（実装の値）。issues の確認事項 1 |
| TC-UT_CAND-015 | createCandidateRng | 正常系 | 同値分割 | createCandidateRng は salt「agent_id:candidates」の createRng と同じ列になる | なし | 種 42、agent-x | createRng(42, 'agent-x:candidates') と同じ列 | B13-T | なし | 一部 TC-NOUS61_DEV-22（判定の列と違うことだけ） |  | TC-UT_CAND-015 createCandidateRng は salt「agent_id:candidates」の createRng と同じ列になる |  |
| TC-UT_CAND-016 | drawCandidates | 正常系 | 依存 | 乱数は選んだ候補の数だけ使う（候補の抽選で余計に消費しない） | なし | candidateCount=3、乱数 0.5 | 乱数の呼び出しは 3 回 | B10-T, B10-F | 呼ばれた回数を数える乱数に差し替え | なし |  | TC-UT_CAND-016 乱数は選んだ候補の数だけ使う |  |
| TC-UT_CAND-017 | drawCandidates | 異常系 | 分岐網羅 | 乱数が 1 を返しても（範囲の外）、区間の末尾の種類を選ぶ（どの区間にも入らないときの既定） | なし | 乱数 1 を返し続ける | ['unfollow','follow'] | B11-F | 乱数を固定の値を返す関数に差し替え | なし |  | TC-UT_CAND-017 乱数が 1 を返しても（範囲の外）、区間の末尾の種類を選ぶ | mulberry32 は 1 を返さないので、B11 が偽のまま終わる経路は乱数を差し替えて通す |

## 3. 確認事項・バグの疑い

- 確認事項 1：重みがすべて 0（または選べる種類の重みがすべて 0）のとき、drawCandidates は post の重みが 0 でも ['post'] を返す（TC-UT_CAND-014）。設計書は「available が空なら ['post']」だけを定めている。設定の検証で弾くか、この動きでよいかを確認したい。
- 確認事項 2：候補の抽選の乱数は salt を「agent_id:candidates」に分けている（NOUS-61 で Kouhei Tajima が了承）。設計書 4章の「3章と同じ種から作る」は満たしているが、salt の決まりは設計書に書かれていないので、改訂のときに追記するとよい。
