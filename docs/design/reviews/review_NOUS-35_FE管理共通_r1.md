# 設計レビュー報告書：FE 詳細設計 管理画面の共通・認証・実行制御・実行設定 v1（第1回）

| 項目 | 内容 |
|---|---|
| 対象 | docs/design/detailed/front/admin_control.md v1 |
| チケット | NOUS-35 |
| レビュー担当 | Kouhei Tajima |
| 実施日 | 2026-10-21 |
| 手順 | structure 05_reviewer_skill |
| 判定 | 条件付き承認 (Conditionally Approved) |

```text
【ファクトチェック・スクラッチパッド】
・対象ドキュメントの種別判定: FE 詳細設計書（admin_control）
・対応スキルのフォーマット照合: 04-1 の 1〜6 章の見出しがすべて存在する
・主要コンポーネントのカウント: コンポーネント 25、IPO 23、アクション 14、検証 11
・禁止ワード検索結果: 見出しの「HOC等」を除き 0 件
・ドキュメント間の整合性: 呼ぶ API はすべて BE admin_auth・world にある。computeEstimate が使う activeAgents（稼働中の体数）と avgParticipation（参加の確率の平均）を返す API がない
```

## 指摘

| No | 重大度 | 内容 | 修正の指示 |
|---|---|---|---|
| m-01 | Minor | P205 の見込みを画面の中で計算し直すのに要る activeAgents・avgParticipation が、GET /admin/api/settings の応答（BE world v1.1、概要 v3.7）にない | BE world と概要の GET /admin/api/settings の応答に2項目を足す（サーバーの estimateDaily が計算に使っている値をそのまま返す） |

## 総評

CSRF トークンをメモリだけに置く方針、403 のときにセッションを取り直してやり直させる処理、未保存の移動の確認は、管理画面を安全に保つ設計としてよい。共通部品を shared/ にまとめ、NOUS-36・37 が使えるようにした点も評価する。
