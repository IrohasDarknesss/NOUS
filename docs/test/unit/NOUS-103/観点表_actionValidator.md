# 単体テスト観点表：意味の検証と本文の切り詰め（generation/actionValidator.ts）

| 項目 | 内容 |
|---|---|
| 関連チケット | NOUS-103 |
| 作成者 | Takaya Ishikawa（開発担当） |
| 作成日 | 2026-10-23 |
| 対象 | apps/server/src/generation/actionValidator.ts |
| 言語 / フレームワーク | TypeScript / Vitest 2.1.9（environment: node） |
| テストファイル | apps/server/src/generation/actionValidator.test.ts（実装時、NOUS-62）, apps/server/src/generation/actionValidator.ut.test.ts（単体テストで追加） |
| 外部依存 | なし（引数の ValidationContext だけを見る純粋関数） |
| 入力にした設計書 | 行動生成とプロンプトの設計 6.3, BE 詳細設計 generation 4章 validateAction・truncateText |

このファイルは `docs/test/unit/_build/build_matrix.py` で JSON から作る。直すときは JSON を直して作り直す。

## 1. 分岐の一覧

| ID | 条件 | 場所 |
|---|---|---|
| B1 | action が none でなく、candidates に含まれない | actionValidator.ts:108 |
| B2 | findRef：refs に P 番号がない | actionValidator.ts:86 |
| B3 | like：対象の投稿が自分のもの（ref.agentId === context.agentId） | actionValidator.ts:124 |
| B4 | like：likeablePostIds に含まれない | actionValidator.ts:127 |
| B5 | findAgent：一覧にハンドルがない | actionValidator.ts:95 |
| B6 | follow：相手が自分（target.agentId === context.agentId） | actionValidator.ts:135 |
| B7 | truncateText：前後の空白を除くと空 | actionValidator.ts:62 |
| B8 | truncateText：140 字以内 | actionValidator.ts:66 |
| B9 | truncateText：140 字以内に「。！？」がある（cut >= 0） | actionValidator.ts:71-77 |
| B10 | truncateText：切った結果が 20 字未満 | actionValidator.ts:78 |
| B11 | switch：none | actionValidator.ts:112 |
| B12 | switch：post | actionValidator.ts:114 |
| B13 | switch：reply | actionValidator.ts:116 |
| B14 | switch：like | actionValidator.ts:121 |
| B15 | switch：follow | actionValidator.ts:132 |
| B16 | switch：unfollow | actionValidator.ts:140 |

## 2. ケースの一覧（30 件。うち新しく足したもの 21 件）

| ID | 対象 | 分類 | 技法 | 観点 | 前提 | 入力 | 期待結果 | 分岐 | モック | 既存テストとの対応 | バグの疑い | テスト名 | 備考 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| TC-NOUS62_DEV-11 | validateAction | 正常系 | 開発者テスト | 合格した行動を P 番号・ハンドルから ID にする | 文脈：P1（haruka）・P2（自分）・P3（zen）、いいねできるのは POST_1、フォローできるのは zen、フォロー中は haruka | reply P1・like P1・follow @zen・unfollow @haruka・post | P 番号・ハンドルを投稿 ID・エージェント ID にした ValidAction | B1-F, B2-F, B3-F, B4-F, B5-F, B6-F, B7-F, B8-T, B12-T, B13-T, B14-T, B15-T, B16-T, B11-F | なし | 実装時のテスト（NOUS-62） |  | TC-NOUS62_DEV-11 合格した行動を P 番号・ハンドルから ID にする |  |
| TC-NOUS62_DEV-12 | validateAction | 正常系 | 開発者テスト | none は候補になくてもいつも選べる | DEV-11 と同じ文脈 | none、候補は post・reply | { action: none } | B1-F, B11-T, B12-F, B13-F, B14-F, B15-F, B16-F | なし | 実装時のテスト（NOUS-62） |  | TC-NOUS62_DEV-12 none は候補になくてもいつも選べる |  |
| TC-NOUS62_DEV-13 | validateAction | 異常系 | 開発者テスト | 各入力 は InvalidFormatError | DEV-11 と同じ文脈 | 候補外・存在しない P 番号・自分の投稿へのいいねなど 9 種 | InvalidFormatError | B1-T, B2-T, B3-T, B4-T, B5-T, B7-T | なし | 実装時のテスト（NOUS-62） |  | TC-NOUS62_DEV-13 %s は InvalidFormatError | detail は UT_VAL-001〜011 で 1 件ずつ確かめる |
| TC-NOUS62_DEV-14 | validateAction | 異常系 | 開発者テスト | 自分を相手にしたフォローは、followTargets に自分が混ざっていても拒否する | followTargets に自分（minato）が混ざっている | follow @minato | InvalidFormatError | B5-F, B6-T | なし | 実装時のテスト（NOUS-62） |  | TC-NOUS62_DEV-14 自分を相手にしたフォローは、followTargets に自分が混ざっていても拒否する |  |
| TC-NOUS62_DEV-15 | truncateText | 正常系 | 開発者テスト | 140 字ちょうどはそのまま | なし | あ×140 | そのまま | B7-F, B8-T | なし | 実装時のテスト（NOUS-62） |  | TC-NOUS62_DEV-15 140 字ちょうどはそのまま |  |
| TC-NOUS62_DEV-16 | truncateText | 正常系 | 開発者テスト | 141 字以上は 140 字以内の最後の「。！？」で切る | なし | あ×50。い×60！う×40（152 字） | あ×50。い×60！ | B8-F, B9-T, B10-F | なし | 実装時のテスト（NOUS-62） |  | TC-NOUS62_DEV-16 141 字以上は 140 字以内の最後の「。！？」で切る |  |
| TC-NOUS62_DEV-17 | truncateText | 異常系 | 開発者テスト | 切った結果が 20 字未満なら InvalidFormatError | なし | あ×10。い×140 | InvalidFormatError | B9-T, B10-T | なし | 実装時のテスト（NOUS-62） |  | TC-NOUS62_DEV-17 切った結果が 20 字未満なら InvalidFormatError |  |
| TC-NOUS62_DEV-18 | truncateText | 異常系 | 開発者テスト | 140 字以内に句点がなければ InvalidFormatError | なし | あ×141 | InvalidFormatError | B9-F, B10-T | なし | 実装時のテスト（NOUS-62） |  | TC-NOUS62_DEV-18 140 字以内に句点がなければ InvalidFormatError |  |
| TC-NOUS62_DEV-19 | truncateText | 正常系 | 開発者テスト | 字数はコードポイントで数える（絵文字 1 つを 1 字） | なし | 😀×140 | そのまま（コードポイントで 140 字） | B8-T | なし | 実装時のテスト（NOUS-62） |  | TC-NOUS62_DEV-19 字数はコードポイントで数える（絵文字 1 つを 1 字） |  |
| TC-UT_VAL-001 | validateAction | 異常系 | 分岐網羅 | 候補にない post は not_candidate:post | DEV-11 と同じ文脈 | post、候補は like だけ | InvalidFormatError、kind=invalid_format、detail=not_candidate:post | B1-T | なし | 一部 TC-NOUS62_DEV-13（like の候補外を、型だけ） |  | TC-UT_VAL-001 候補にない post は not_candidate:post |  |
| TC-UT_VAL-002 | validateAction | 異常系 | 分岐網羅 | 候補にない reply は、P 番号が正しくても not_candidate:reply | DEV-11 と同じ文脈 | reply P1、候補は post・like | detail=not_candidate:reply（P 番号が正しくても候補外を先に見る） | B1-T | なし | なし |  | TC-UT_VAL-002 候補にない reply は、P 番号が正しくても not_candidate:reply |  |
| TC-UT_VAL-003 | validateAction | 異常系 | エラー処理 | 参照する投稿にない P 番号は unknown_ref | DEV-11 と同じ文脈 | reply P9 | detail=unknown_ref:P9 | B1-F, B2-T, B13-T, B11-F, B12-F, B14-F, B15-F, B16-F | なし | 一部 TC-NOUS62_DEV-13（型だけ） |  | TC-UT_VAL-003 参照する投稿にない P 番号は unknown_ref |  |
| TC-UT_VAL-004 | validateAction | 異常系 | エラー処理 | 自分の投稿へのいいねは like_own_post | DEV-11 と同じ文脈 | like P2 | detail=like_own_post:P2 | B2-F, B3-T, B14-T, B11-F, B12-F, B13-F, B15-F, B16-F | なし | 一部 TC-NOUS62_DEV-13（型だけ） |  | TC-UT_VAL-004 自分の投稿へのいいねは like_own_post |  |
| TC-UT_VAL-005 | validateAction | 異常系 | エラー処理 | いいね済みの投稿へのいいねは already_liked | DEV-11 と同じ文脈 | like P3 | detail=already_liked:P3 | B3-F, B4-T | なし | 一部 TC-NOUS62_DEV-13（型だけ） |  | TC-UT_VAL-005 いいね済みの投稿へのいいねは already_liked |  |
| TC-UT_VAL-006 | validateAction | 異常系 | エラー処理 | フォローできる住人にない相手のフォローは not_followable | DEV-11 と同じ文脈 | follow @haruka | detail=not_followable:@haruka | B5-T, B15-T, B11-F, B12-F, B13-F, B14-F, B16-F | なし | 一部 TC-NOUS62_DEV-13（型だけ） |  | TC-UT_VAL-006 フォローできる住人にない相手のフォローは not_followable |  |
| TC-UT_VAL-007 | validateAction | 異常系 | エラー処理 | フォロー中でない相手の解除は not_following | DEV-11 と同じ文脈 | unfollow @zen | detail=not_following:@zen | B5-T, B16-T, B11-F, B12-F, B13-F, B14-F, B15-F | なし | 一部 TC-NOUS62_DEV-13（型だけ） |  | TC-UT_VAL-007 フォロー中でない相手の解除は not_following |  |
| TC-UT_VAL-008 | validateAction | 異常系 | エラー処理 | 自分へのフォローは follow_self | followTargets に自分（minato）だけ | follow @minato | detail=follow_self:@minato | B5-F, B6-T | なし | 一部 TC-NOUS62_DEV-14（型だけ） |  | TC-UT_VAL-008 自分へのフォローは follow_self |  |
| TC-UT_VAL-009 | validateAction | 異常系 | 境界値 | 参照する投稿が 0 件の文脈での reply は unknown_ref | refs と likeablePostIds が空 | reply P1 | detail=unknown_ref:P1 | B2-T, B13-T, B11-F, B12-F, B14-F, B15-F, B16-F | なし | なし |  | TC-UT_VAL-009 参照する投稿が 0 件の文脈での reply は unknown_ref | NOUS-102 の TC-UT_PRM-031（参照する投稿をすべて外しても候補に reply・like が残る）のときの動き |
| TC-UT_VAL-021 | validateAction | 異常系 | 境界値 | 参照する投稿が 0 件の文脈での like も unknown_ref | refs と likeablePostIds が空 | like P1 | detail=unknown_ref:P1 | B2-T, B14-T, B11-F, B12-F, B13-F, B15-F, B16-F | なし | なし |  | TC-UT_VAL-021 参照する投稿が 0 件の文脈での like も unknown_ref | TC-UT_VAL-009 と同じく、NOUS-102 の TC-UT_PRM-031 のときの動き。再生成になり、2 回目も選べば invalid_format で閉じる（試行が無駄になる） |
| TC-UT_VAL-010 | validateAction | 正常系 | 分岐網羅 | reply の本文も 140 字を超えれば、140 字以内の最後の句点で切る | DEV-11 と同じ文脈 | reply P1、text = あ×100。い×60（161 字） | text = あ×100。（101 字）、targetPostId = POST_1 | B8-F, B9-T, B10-F, B13-T, B11-F, B12-F, B14-F, B15-F, B16-F | なし | なし（DEV の切り詰めは truncateText を直に呼ぶだけ） |  | TC-UT_VAL-010 reply の本文も 140 字を超えれば、140 字以内の最後の句点で切る |  |
| TC-UT_VAL-011 | validateAction | 異常系 | 分岐網羅 | reply の本文が空白だけなら text_blank | DEV-11 と同じ文脈 | reply P1、text = " \n " | detail=text_blank | B7-T, B13-T, B11-F, B12-F, B14-F, B15-F, B16-F | なし | 一部 TC-NOUS62_DEV-13（post の空白だけ） |  | TC-UT_VAL-011 reply の本文が空白だけなら text_blank |  |
| TC-UT_VAL-012 | truncateText | 正常系 | 境界値 | 1 字の本文はそのまま合格する | なし | あ（1 字） | そのまま | B7-F, B8-T | なし | なし |  | TC-UT_VAL-012 1 字の本文はそのまま合格する |  |
| TC-UT_VAL-013 | truncateText | 異常系 | 同値分割 | 全角スペースだけの本文は text_blank | なし | 全角スペース×2 | detail=text_blank | B7-T | なし | なし（DEV は半角の空白だけ） |  | TC-UT_VAL-013 全角スペースだけの本文は text_blank |  |
| TC-UT_VAL-014 | truncateText | 正常系 | 境界値 | 前後の空白は字数を数える前に除く（中身が 140 字ならそのまま） | なし | 前に半角スペース 2 つ、後ろに改行を付けた あ×140 | あ×140（空白を除いてから数える） | B7-F, B8-T | なし | なし |  | TC-UT_VAL-014 前後の空白は字数を数える前に除く（中身が 140 字ならそのまま） |  |
| TC-UT_VAL-015 | truncateText | 正常系 | 境界値 | 141 字（1 字だけ超え）は句点で切る | なし | あ×100。い×40（141 字） | あ×100。 | B8-F, B9-T, B10-F | なし | なし（DEV は 152 字） |  | TC-UT_VAL-015 141 字（1 字だけ超え）は句点で切る |  |
| TC-UT_VAL-016 | truncateText | 正常系 | 境界値 | 140 字目が句点なら 140 字で切る | なし | あ×139。い×5 | あ×139。（140 字） | B8-F, B9-T, B10-F | なし | なし |  | TC-UT_VAL-016 140 字目が句点なら 140 字で切る |  |
| TC-UT_VAL-017 | truncateText | 正常系 | 境界値 | 141 字目の句点は使わず、140 字以内の最後の句点で切る | なし | あ×50。い×89。う（141 字目が句点） | あ×50。 | B8-F, B9-T, B10-F | なし | なし |  | TC-UT_VAL-017 141 字目の句点は使わず、140 字以内の最後の句点で切る |  |
| TC-UT_VAL-018 | truncateText | 正常系 | 境界値 | 切った結果がちょうど 20 字なら合格する | なし | あ×19！い×130 | あ×19！（20 字） | B9-T, B10-F | なし | なし（DEV-17 は 11 字） |  | TC-UT_VAL-018 切った結果がちょうど 20 字なら合格する |  |
| TC-UT_VAL-019 | truncateText | 異常系 | 境界値 | 切った結果が 19 字なら text_too_long | なし | あ×18？い×130 | detail=text_too_long | B9-T, B10-T | なし | 一部 TC-NOUS62_DEV-17（11 字、型だけ） |  | TC-UT_VAL-019 切った結果が 19 字なら text_too_long |  |
| TC-UT_VAL-020 | truncateText | 異常系 | 同値分割 | 半角の ! ? では切らない（140 字以内に全角の句点がなければ text_too_long） | なし | あ×30!い×30?う×90（半角の ! ?） | detail=text_too_long | B9-F, B10-T | なし | なし |  | TC-UT_VAL-020 半角の ! ? では切らない（140 字以内に全角の句点がなければ text_too_long） | 確認事項 1 を参照 |

## 3. 確認事項・バグの疑い

- 確認事項 1：truncateText は 6.3 のとおり全角の「。！？」だけで切る。一方、consistencyChecker の splitSentences は半角の「!?」でも文を分ける。どちらも設計書どおりだが、文の区切りの扱いがそろっていない。
