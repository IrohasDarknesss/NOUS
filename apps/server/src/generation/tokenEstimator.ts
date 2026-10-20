// トークン数の見積もり（BE 詳細設計：行動生成 4章 estimateTokens・loadTokenRatio、行動生成とプロンプトの設計 5.1）。
// メッセージの文字数に 0.6 を掛けて見積もる。直近の実測の比が 0.6 を超えていれば、その比を使う
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import type { ChatMessage } from "../llm/llmClient";
import type { DbOrTx } from "../db/tx";
import { generation_events } from "../db/schema";

/** 文字数に対するトークン数の比の既定（試行の実測 0.56〜0.58 に余裕を足した値） */
export const DEFAULT_TOKEN_RATIO = 0.6;
/** 実測の比を求めるのに使う、直近の成功した LLM の生成イベントの件数 */
export const TOKEN_RATIO_SAMPLE = 50;
/** 実測の比を使うのに必要な件数。これより少なければ既定の比を使う */
export const TOKEN_RATIO_MIN_SAMPLES = 20;

/** 文字数（SQLite の length と同じく、コードポイントで数える） */
export function countChars(text: string): number {
  return Array.from(text).length;
}

/** 全メッセージの文字数の合計に max(0.6, ratio) を掛けて切り上げる */
export function estimateTokens(messages: readonly ChatMessage[], ratio: number): number {
  const chars = messages.reduce((sum, m) => sum + countChars(m.content), 0);
  return Math.ceil(chars * Math.max(DEFAULT_TOKEN_RATIO, ratio));
}

/**
 * 直近 50 件の成功した LLM の生成の prompt_tokens ÷ length(prompt_text) の平均。
 * 使える行が 20 件未満なら 0.6
 */
export function loadTokenRatio(db: DbOrTx): number {
  const rows = db
    .select({
      promptTokens: generation_events.prompt_tokens,
      chars: sql<number>`length(${generation_events.prompt_text})`,
    })
    .from(generation_events)
    .where(
      and(
        eq(generation_events.decided_by, "llm"),
        eq(generation_events.status, "succeeded"),
        isNotNull(generation_events.prompt_text),
      ),
    )
    .orderBy(desc(generation_events.started_at))
    .limit(TOKEN_RATIO_SAMPLE)
    .all()
    .filter((row) => row.chars > 0 && row.promptTokens > 0);
  if (rows.length < TOKEN_RATIO_MIN_SAMPLES) return DEFAULT_TOKEN_RATIO;
  return rows.reduce((sum, row) => sum + row.promptTokens / row.chars, 0) / rows.length;
}
