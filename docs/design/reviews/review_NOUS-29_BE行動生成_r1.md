# 設計レビュー報告書：BE 詳細設計 行動生成 v1（第1回）

| 項目 | 内容 |
|---|---|
| 対象 | docs/design/detailed/back/generation.md v1 |
| チケット | NOUS-29 |
| レビュー担当 | Kouhei Tajima |
| 実施日 | 2026-10-21 |
| 手順 | structure 05_reviewer_skill |
| 判定 | 差し戻し (Needs Revision) |

```text
【ファクトチェック・スクラッチパッド】
・対象ドキュメントの種別判定: BE 詳細設計書（generation）
・対応スキルのフォーマット照合: 04-2 の 1〜6 章の見出しがすべて存在する
・主要コンポーネントのカウント: IPO 30 関数。API 0 本（HTTP の API がない領域のため、外部連携1件と内部インタフェース2件をテンプレートで記述し、理由を1章に明記）
・禁止ワード検索結果: 0 件
・物理名: 3章・4章で使うテーブル・カラムはすべて DB 物理設計書 v1.1 にある
・上限の判定に使う値の加算: daily_usage の calls・トークン・Neurons は recordAttempt で加算されるが、runs（実行回数の上限と比べる値）を加算する処理がない
```

## 指摘

| No | 重大度 | 内容 | 修正の指示 |
|---|---|---|---|
| M-01 | Major | daily_usage.runs を加算する処理がない。実行回数の日次上限（既定 480）が判定されず、FR-403 を満たさない | LLM を呼ぶ生成イベントにつき1回だけ（最初の試行の記録のとき）runs を +1 する処理を、recordAttempt の処理フローと 3章 addDailyUsage に書く |
| I-01 | Info | 多重実行（UNIQUE の違反）を failed（invalid_format）で閉じるため、生成ログで多重実行と形式の誤りの区別がつかない | generation_attempts.error_detail に 'duplicate_action' を残すことを書く（failure_kind の値は増やさない） |

## 総評

LLM を待つ間にトランザクションを開かない設計、緊急停止の signal と時間切れの合成、固定応答の遅延と失敗の再現は、テスト計画の要望（T-02）まで含めてよくできている。M-01 は上限の判定の根幹のため、直してから承認する。
