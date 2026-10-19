# 横断整合性レビュー報告書：詳細設計一式

| 項目 | 内容 |
|---|---|
| 対象 | DB 物理設計書 v1.1、BE 詳細設計 5 件（generation v1.1・world v1.2・observer v1・admin_auth v1・admin_data v1）、FE 詳細設計 4 件（observer・admin_control・admin_agents_logs・admin_moderation 各 v1）、結合テスト観点表 v1、基本設計書（概要）v3.9、画面基本設計書 |
| チケット | NOUS-40 |
| レビュー担当 | Kouhei Tajima |
| 実施日 | 2026-10-21 |
| 手順 | structure 06_consistency_review_skill |
| 判定 | 承認 |

## Phase 1 機械的検出

| 観点 | 検査 | 結果 |
|---|---|---|
| B 用語・識別子（物理名） | BE 詳細設計と観点表の「テーブル.カラム」を schema.sql の 17 テーブルと照合 | 不一致 0 |
| C 相互参照（API） | 概要の内部 API 38 本と、BE 詳細設計の API の見出し | 38 本すべてが BE のどれか1つの文書に1回だけある。過不足 0 |
| C 相互参照（FE → BE） | FE 詳細設計が呼ぶ API と、BE 詳細設計の API | 不一致 0 |
| D 自己整合性（エラーコード） | FE のエラーの表のコードと、BE・概要のコード | 不一致 0（検出 3 件は文書番号の文字列の誤検出） |
| E 業務ルール（テスト） | 観点表の API・関数と BE 詳細設計 | 不一致 0（検出は「stop・resume」のようにまとめた表記と、カラム名の誤検出） |
| A 確定仕様ドリフト | 概要の応答の項目と BE の応答 | BE が画面のために足した 5 項目（lastAction・decidedBy・refPosts・generationEventId・neuronsLimit）が概要になかった（A-01）。概要 v3.9 で反映済み |

## Phase 2・3 目視と業務知識

| 観点 | 確認したこと |
|---|---|
| 費用 | 上限の判定（world の isWithinLimits）に使う daily_usage.runs・neurons が、generation の recordAttempt で加算される（NOUS-29 の M-01 の修正）。リセットしても同じ利用日の利用量を引き継ぐ |
| 停止 | pause・emergency-stop（world）→ Scheduler.stopAll → runOpportunity の signal と shouldContinue（generation）→ 生成イベントの cancelled（DB の CHECK）まで、名前と状態が一貫している |
| 世界内時間 | world の settleWorldTime・beat・recoverOnStartup と、DB の CHECK（running と running_since）が一致 |
| 安全 | 観察サーバーの書き込みの拒否（observer の readOnly と lint の import の制限）、管理サーバーの 127.0.0.1（admin_auth）、CSRF をメモリだけに置く画面（admin_control）がそろっている |
| 文書をまたいだ食い違いの修正 | 詳細設計の過程で、準備中のリセット（NOUS-30）、LAN のアドレスがないときのエラー（NOUS-32）、見込みの計算の項目（NOUS-35）、観察 API のパラメータ（NOUS-31）を、概要と画面基本設計書に戻して直した。概要は v3.6 から v3.9 |

## 指摘

| No | 重大度 | 内容 | 状態 |
|---|---|---|---|
| A-01 | Minor | BE が足した応答の 5 項目が概要にない | 概要 v3.9 で修正済み |

## 残っている作業

- NOUS-39：Node.js 22 LTS の導入と pnpm install の可否を、admin に確認中（「再鑑」・担当 Kaine Yamashiro）。これが済むまで、エピック NOUS-27 は完了にしない
