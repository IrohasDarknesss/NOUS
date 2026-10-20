// 記憶の更新（BE 詳細設計 generation 4章 updateMemories、行動生成とプロンプトの設計 8章、BT-003）。
// LLM を使わず、反映済みの posts・likes・follows から規則で作り直す（Q-214）。commitAction の中で applyAction の後に呼ぶ。
// interest_profile は登録・編集のときに作るので、ここでは触らない。
import { sql } from "drizzle-orm";
import { memories, type MEMORY_KINDS } from "../db/schema";
import type { Tx } from "../db/tx";
import { newUlid } from "../lib/ids";

type MemoryKind = (typeof MEMORY_KINDS)[number];

/** 長さの上限（8章） */
export const MEMORY_LIMITS = {
  recent_posts: 400,
  relationship_summary: 300,
  conversation_summary: 300,
} as const;

const RECENT_ACTIONS = 5;
const RECENT_POSTS = 5;
const RELATIONSHIPS = 5;
const THREADS = 3;

/** コードポイントで数えて n 字までにする */
export function clip(text: string, n: number): string {
  const cs = [...text];
  return cs.length <= n ? text : cs.slice(0, n).join("");
}

/** 行をまたいで max 字に収める。入りきらない行は捨てる（途中で切った行を残さない） */
function joinLines(lines: string[], max: number): string {
  const out: string[] = [];
  let used = 0;
  for (const line of lines) {
    const len = [...line].length + (out.length > 0 ? 1 : 0);
    if (used + len > max) {
      break;
    }
    out.push(line);
    used += len;
  }
  return out.join("\n");
}

const oneLine = (s: string): string => s.replace(/\s+/g, " ").trim();

type RecentActionRow = { kind: string; body: string | null; other: string | null };

/** recent_posts：最近の行動の 5 件（「post：本文の先頭 30 字」「like：@相手」）と、最近の投稿の本文の 5 件 */
export function buildRecentPosts(tx: Tx, agentId: string): string {
  const actions = tx.all<RecentActionRow>(sql`
    SELECT kind, body, other FROM (
      SELECT CASE WHEN p.reply_to_post_id IS NULL THEN 'post' ELSE 'reply' END AS kind, p.body AS body,
             (SELECT a.handle FROM posts q JOIN agents a ON a.agent_id = q.agent_id WHERE q.post_id = p.reply_to_post_id) AS other,
             p.world_time_sec AS wts, p.generation_event_id AS ord
        FROM posts p WHERE p.agent_id = ${agentId} AND p.visibility = 'public'
      UNION ALL
      SELECT 'like', NULL, a.handle, l.world_time_sec, l.generation_event_id
        FROM likes l JOIN posts q ON q.post_id = l.post_id JOIN agents a ON a.agent_id = q.agent_id
       WHERE l.agent_id = ${agentId}
      UNION ALL
      SELECT 'follow', NULL, a.handle, f.started_world_sec, f.start_event_id
        FROM follows f JOIN agents a ON a.agent_id = f.followee_id WHERE f.follower_id = ${agentId}
      UNION ALL
      SELECT 'unfollow', NULL, a.handle, f.ended_world_sec, f.end_event_id
        FROM follows f JOIN agents a ON a.agent_id = f.followee_id
       WHERE f.follower_id = ${agentId} AND f.end_event_id IS NOT NULL
    ) ORDER BY wts DESC, ord DESC LIMIT ${RECENT_ACTIONS}
  `);
  const bodies = tx.all<{ body: string }>(sql`
    SELECT body FROM posts WHERE agent_id = ${agentId} AND visibility = 'public'
     ORDER BY world_time_sec DESC, post_id DESC LIMIT ${RECENT_POSTS}
  `);

  const actionLines = actions.map((a) => {
    switch (a.kind) {
      case "post":
        return `- post：${clip(oneLine(a.body ?? ""), 30)}`;
      case "reply":
        return `- reply @${a.other ?? "?"}：${clip(oneLine(a.body ?? ""), 30)}`;
      default:
        return `- ${a.kind}：@${a.other ?? "?"}`;
    }
  });
  const lines = ["最近の行動：", ...actionLines, "最近の投稿：", ...bodies.map((b) => `- ${oneLine(b.body)}`)];
  return joinLines(lines, MEMORY_LIMITS.recent_posts);
}

type Relation = { handle: string; following: boolean; repliesTo: number; repliesFrom: number; likes: number };

/** relationship_summary：相手ごとのフォローの有無・返信の回数・返信を受けた回数・いいねの回数を、多い順に 5 体まで */
export function buildRelationshipSummary(tx: Tx, agentId: string): string {
  const rows = tx.all<{ agent_id: string; handle: string; kind: string; n: number }>(sql`
    SELECT a.agent_id, a.handle, 'following' AS kind, 1 AS n
      FROM follows f JOIN agents a ON a.agent_id = f.followee_id
     WHERE f.follower_id = ${agentId} AND f.ended_world_sec IS NULL
    UNION ALL
    SELECT a.agent_id, a.handle, 'repliesTo', count(*)
      FROM posts p JOIN posts q ON q.post_id = p.reply_to_post_id JOIN agents a ON a.agent_id = q.agent_id
     WHERE p.agent_id = ${agentId} AND q.agent_id <> ${agentId}
     GROUP BY a.agent_id
    UNION ALL
    SELECT a.agent_id, a.handle, 'repliesFrom', count(*)
      FROM posts p JOIN posts q ON q.post_id = p.reply_to_post_id JOIN agents a ON a.agent_id = p.agent_id
     WHERE q.agent_id = ${agentId} AND p.agent_id <> ${agentId}
     GROUP BY a.agent_id
    UNION ALL
    SELECT a.agent_id, a.handle, 'likes', count(*)
      FROM likes l JOIN posts q ON q.post_id = l.post_id JOIN agents a ON a.agent_id = q.agent_id
     WHERE l.agent_id = ${agentId}
     GROUP BY a.agent_id
  `);
  const byAgent = new Map<string, Relation>();
  for (const r of rows) {
    const rel = byAgent.get(r.agent_id) ?? {
      handle: r.handle,
      following: false,
      repliesTo: 0,
      repliesFrom: 0,
      likes: 0,
    };
    if (r.kind === "following") rel.following = true;
    if (r.kind === "repliesTo") rel.repliesTo = r.n;
    if (r.kind === "repliesFrom") rel.repliesFrom = r.n;
    if (r.kind === "likes") rel.likes = r.n;
    byAgent.set(r.agent_id, rel);
  }
  const total = (r: Relation): number => r.repliesTo + r.repliesFrom + r.likes;
  const top = [...byAgent.values()]
    .sort(
      (a, b) => total(b) - total(a) || Number(b.following) - Number(a.following) || a.handle.localeCompare(b.handle),
    )
    .slice(0, RELATIONSHIPS);
  const lines = top.map((r) => {
    const parts: string[] = [];
    if (r.following) parts.push("フォロー中");
    if (r.repliesTo > 0) parts.push(`返信 ${r.repliesTo} 回`);
    if (r.repliesFrom > 0) parts.push(`返信を受けた ${r.repliesFrom} 回`);
    if (r.likes > 0) parts.push(`いいね ${r.likes} 回`);
    return `@${r.handle}：${parts.join("、")}`;
  });
  return joinLines(lines, MEMORY_LIMITS.relationship_summary);
}

/** conversation_summary：自分が加わった直近 3 つのスレッドの、起点の本文の先頭 40 字と、最後の発言者 */
export function buildConversationSummary(tx: Tx, agentId: string): string {
  const threads = tx.all<{ root_body: string; last_handle: string }>(sql`
    WITH mine AS (
      SELECT DISTINCT root_post_id FROM posts WHERE agent_id = ${agentId}
    ),
    thread AS (
      SELECT p.root_post_id, max(p.world_time_sec) AS last_wts, count(*) AS n
        FROM posts p JOIN mine m ON m.root_post_id = p.root_post_id
       WHERE p.visibility = 'public'
       GROUP BY p.root_post_id
      HAVING count(*) >= 2
    )
    SELECT r.body AS root_body,
           (SELECT a.handle FROM posts x JOIN agents a ON a.agent_id = x.agent_id
             WHERE x.root_post_id = t.root_post_id AND x.visibility = 'public'
             ORDER BY x.world_time_sec DESC, x.post_id DESC LIMIT 1) AS last_handle
      FROM thread t JOIN posts r ON r.post_id = t.root_post_id
     ORDER BY t.last_wts DESC, t.root_post_id DESC
     LIMIT ${THREADS}
  `);
  const lines = threads.map((t) => `「${clip(oneLine(t.root_body), 40)}」最後の発言：@${t.last_handle}`);
  return joinLines(lines, MEMORY_LIMITS.conversation_summary);
}

/** INSERT … ON CONFLICT(agent_id, kind) DO UPDATE（3章 upsertMemory） */
export function upsertMemory(tx: Tx, agentId: string, kind: MemoryKind, content: string, nowIso: string): void {
  tx.insert(memories)
    .values({ memory_id: newUlid(), agent_id: agentId, kind, content, updated_at: nowIso })
    .onConflictDoUpdate({
      target: [memories.agent_id, memories.kind],
      set: { content, updated_at: nowIso },
    })
    .run();
}

/**
 * 成功した行動のたびに recent_posts と relationship_summary を作り直す。conversation_summary は reply のときだけ。
 * none は行の追加がないので何もしない
 */
export function updateMemories(
  tx: Tx,
  agentId: string,
  action: { action: "post" | "reply" | "like" | "follow" | "unfollow" | "none" },
  nowIso: string,
): void {
  if (action.action === "none") {
    return;
  }
  upsertMemory(tx, agentId, "recent_posts", buildRecentPosts(tx, agentId), nowIso);
  upsertMemory(tx, agentId, "relationship_summary", buildRelationshipSummary(tx, agentId), nowIso);
  if (action.action === "reply") {
    upsertMemory(tx, agentId, "conversation_summary", buildConversationSummary(tx, agentId), nowIso);
  }
}
