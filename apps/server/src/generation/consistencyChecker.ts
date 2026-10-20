// 記憶との矛盾の検査 C01〜C04（BE 詳細設計 generation 4章 checkConsistency、行動生成とプロンプトの設計 9章、FR-217）。
// 追加の LLM の呼び出しを使わず、規則で候補を見つけるだけで、行動は防がない（Q-214）。
// commitAction の中で applyAction の後に呼ぶので、今回の投稿は eventId で除いて比べる。
import type { ConsistencyFlag } from "@nous/shared";
import { sql } from "drizzle-orm";
import type { GenerationConfig } from "../config/generationConfig";
import type { Tx } from "../db/tx";
import type { ValidAction } from "./actionValidator";

/** C01：解除から何巡以内の返信を候補にするか */
export const C01_CYCLES = 3;
/** C02：同じ文とみなす長さ */
export const C02_MIN_CHARS = 20;

const MENTION_PATTERN = /@([A-Za-z0-9_]{3,20})/g;

export type ConsistencyContext = {
  worldId: string;
  agentId: string;
  /** 今回の生成イベント（反映した自分の投稿を比べる対象から外す） */
  eventId: string;
  cycleNo: number;
  /** agents.personality */
  personality: string;
};

/** 文に分ける（。！？!? と改行の後ろで切る） */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[。！？!?])|\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** C01：reply の相手が、自分がフォローを解除した住人で、解除から 3 巡以内 */
function checkC01(tx: Tx, action: ValidAction, ctx: ConsistencyContext): ConsistencyFlag[] {
  if (action.action !== "reply") {
    return [];
  }
  const row = tx.get<{ handle: string; ended_cycle: number } | undefined>(sql`
    SELECT a.handle AS handle, max(e.cycle_no) AS ended_cycle
      FROM posts p
      JOIN follows f ON f.followee_id = p.agent_id AND f.follower_id = ${ctx.agentId} AND f.end_event_id IS NOT NULL
      JOIN generation_events e ON e.event_id = f.end_event_id
      JOIN agents a ON a.agent_id = p.agent_id
     WHERE p.post_id = ${action.targetPostId}
     GROUP BY a.handle
  `);
  if (row === undefined || row.ended_cycle === null || ctx.cycleNo - row.ended_cycle > C01_CYCLES) {
    return [];
  }
  return [
    {
      code: "C01",
      detail: `@${row.handle} へのフォローを ${row.ended_cycle} 巡目に解除した後、${ctx.cycleNo} 巡目に返信した`,
    },
  ];
}

/** C02：post・reply の本文に、自分の過去の投稿と同じ文（20 字以上）がある */
function checkC02(tx: Tx, text: string, ctx: ConsistencyContext): ConsistencyFlag[] {
  const flags: ConsistencyFlag[] = [];
  for (const sentence of new Set(splitSentences(text))) {
    if ([...sentence].length < C02_MIN_CHARS) {
      continue;
    }
    const hit = tx.get<{ post_id: string } | undefined>(sql`
      SELECT post_id FROM posts
       WHERE agent_id = ${ctx.agentId} AND world_id = ${ctx.worldId} AND generation_event_id <> ${ctx.eventId}
         AND instr(body, ${sentence}) > 0
       ORDER BY world_time_sec DESC LIMIT 1
    `);
    if (hit !== undefined) {
      flags.push({ code: "C02", detail: `過去の投稿（${hit.post_id}）と同じ文：${sentence}` });
    }
  }
  return flags;
}

/** C03：性格の記述にキーワードがあるとき、合わない一人称が本文にある（表は config/generation.json） */
function checkC03(text: string, ctx: ConsistencyContext, config: GenerationConfig): ConsistencyFlag[] {
  const flags: ConsistencyFlag[] = [];
  for (const rule of config.firstPersonRules) {
    const keyword = rule.keywords.find((k) => ctx.personality.includes(k));
    if (keyword === undefined) {
      continue;
    }
    const found = rule.mismatch.filter((w) => text.includes(w));
    if (found.length > 0) {
      flags.push({ code: "C03", detail: `性格に「${keyword}」とあるが、本文に「${found.join("」「")}」がある` });
    }
  }
  return flags;
}

/** C04：本文に、世界にいない住人の @ハンドルがある（生成の時点の同じ世界のエージェント） */
function checkC04(tx: Tx, text: string, ctx: ConsistencyContext): ConsistencyFlag[] {
  const mentioned = [...new Set([...text.matchAll(MENTION_PATTERN)].map((m) => m[1] as string))];
  if (mentioned.length === 0) {
    return [];
  }
  const known = new Set(
    tx.all<{ handle: string }>(sql`SELECT handle FROM agents WHERE world_id = ${ctx.worldId}`).map((r) => r.handle),
  );
  const missing = mentioned.filter((h) => !known.has(h));
  return missing.length > 0
    ? [{ code: "C04", detail: `世界にいない住人への言及：${missing.map((h) => `@${h}`).join("、")}` }]
    : [];
}

/** C01〜C04 の候補を返す。なければ空の配列 */
export function checkConsistency(
  tx: Tx,
  action: ValidAction,
  ctx: ConsistencyContext,
  config: GenerationConfig,
): ConsistencyFlag[] {
  const flags = [...checkC01(tx, action, ctx)];
  if (action.action === "post" || action.action === "reply") {
    flags.push(...checkC02(tx, action.text, ctx));
    flags.push(...checkC03(action.text, ctx, config));
    flags.push(...checkC04(tx, action.text, ctx));
  }
  return flags;
}
