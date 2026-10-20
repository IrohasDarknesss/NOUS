// 入力に使う文脈の読み込み（BE 詳細設計：行動生成 3章・4章 loadContext・selectRefPosts、
// 行動生成とプロンプトの設計 5.2）。人格・記憶・直近の行動・参照する投稿・いいねできる投稿・相手の一覧を読む
import { and, asc, desc, eq, exists, inArray, isNull, ne, notExists, notInArray, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import type { ActionKind } from "../config/generationConfig";
import { agents, follows, generation_events, likes, memories, MEMORY_KINDS, posts } from "../db/schema";
import type { DbOrTx } from "../db/tx";

export type AgentRow = typeof agents.$inferSelect;
export type MemoryKind = (typeof MEMORY_KINDS)[number];

/** 参照する投稿。ref は入力の中の番号（P1 から） */
export type RefPost = {
  ref: string;
  postId: string;
  agentId: string;
  handle: string;
  displayName: string;
  body: string;
  /** 返信先の投稿の書き手のハンドル。返信でなければ null */
  replyToHandle: string | null;
  worldTimeSec: number;
};

export type AgentRef = {
  agentId: string;
  handle: string;
  displayName: string;
};

export type MemoryEntry = {
  kind: MemoryKind;
  content: string;
};

export type AgentContext = {
  agent: AgentRow;
  /** interest_profile → recent_posts → relationship_summary → conversation_summary の順。空のものは除く */
  memories: MemoryEntry[];
  /** 直近 2 回の自分の行動（none を除く、新しい順） */
  recentActions: ActionKind[];
  /** 世界内時間の古い順。P1 から番号を付ける */
  refs: RefPost[];
  /** 参照する投稿のうち、まだいいねしていないものの投稿 ID */
  likeablePostIds: string[];
  /** フォローできる住人（自分以外で、フォローしていない稼働中のエージェント） */
  followTargets: AgentRef[];
  /** フォロー中の住人 */
  followees: AgentRef[];
};

export type ContextInput = {
  db: DbOrTx;
  worldId: string;
  agentId: string;
};

export type ContextSettings = {
  /** world_settings.max_ref_posts（1〜30） */
  max_ref_posts: number;
};

/** 参照する投稿の優先 1（自分の投稿への返信）の上限 */
export const MAX_REPLIES_TO_ME = 3;
/** 参照する投稿の優先 2（フォロー中の住人の投稿）の上限 */
export const MAX_FOLLOWEE_POSTS = 5;
/** フォローできる住人の一覧の上限 */
export const MAX_FOLLOW_TARGETS = 8;
/** 直近の自分の行動として読む件数 */
export const RECENT_ACTIONS = 2;

/** 行動機会の対象のエージェントが、稼働中でない（停止された直後など） */
export class AgentNotActiveError extends Error {
  constructor(agentId: string) {
    super(`エージェントが稼働中ではありません: ${agentId}`);
    this.name = "AgentNotActiveError";
  }
}

/** 稼働中のエージェントを読む。いなければ AgentNotActiveError */
export function loadAgent(db: DbOrTx, worldId: string, agentId: string): AgentRow {
  const row = db
    .select()
    .from(agents)
    .where(and(eq(agents.agent_id, agentId), eq(agents.world_id, worldId), eq(agents.state, "active")))
    .get();
  if (!row) throw new AgentNotActiveError(agentId);
  return row;
}

/** 記憶の 4 種を1回で読み、固定の順に並べる */
export function loadMemories(db: DbOrTx, agentId: string): MemoryEntry[] {
  const rows = db
    .select({ kind: memories.kind, content: memories.content })
    .from(memories)
    .where(eq(memories.agent_id, agentId))
    .all();
  const byKind = new Map(rows.map((row) => [row.kind, row.content]));
  return MEMORY_KINDS.flatMap((kind) => {
    const content = byKind.get(kind);
    return content && content.trim().length > 0 ? [{ kind, content }] : [];
  });
}

/** 直近 2 回の自分の成功した行動（none を除く） */
export function loadRecentActions(db: DbOrTx, worldId: string, agentId: string): ActionKind[] {
  const rows = db
    .select({ action: generation_events.action })
    .from(generation_events)
    .where(
      and(
        eq(generation_events.world_id, worldId),
        eq(generation_events.agent_id, agentId),
        eq(generation_events.status, "succeeded"),
        ne(generation_events.action, "none"),
      ),
    )
    .orderBy(desc(generation_events.started_at))
    .limit(RECENT_ACTIONS)
    .all();
  return rows.flatMap((row) => (row.action && row.action !== "none" ? [row.action] : []));
}

const author = alias(agents, "author");
const parent = alias(posts, "parent");
const parentAuthor = alias(agents, "parent_author");

type PostRow = Omit<RefPost, "ref">;

/** 公開中の投稿を、書き手と返信先の書き手のハンドル付きで読む。where と並びと件数は呼び出し側で決める */
function selectPosts(db: DbOrTx, where: SQL | undefined, limit: number, join?: "followee", me?: string): PostRow[] {
  let query = db
    .select({
      postId: posts.post_id,
      agentId: posts.agent_id,
      handle: author.handle,
      displayName: author.display_name,
      body: posts.body,
      replyToHandle: parentAuthor.handle,
      worldTimeSec: posts.world_time_sec,
    })
    .from(posts)
    .innerJoin(author, eq(author.agent_id, posts.agent_id))
    .leftJoin(parent, eq(parent.post_id, posts.reply_to_post_id))
    .leftJoin(parentAuthor, eq(parentAuthor.agent_id, parent.agent_id))
    .$dynamic();
  if (join === "followee" && me !== undefined) {
    query = query.innerJoin(
      follows,
      and(eq(follows.followee_id, posts.agent_id), eq(follows.follower_id, me), isNull(follows.ended_world_sec)),
    );
  }
  return query.where(where).orderBy(desc(posts.world_time_sec), desc(posts.post_id)).limit(limit).all();
}

/** 他の住人の公開中の投稿で、まだ選んでいないもの */
function othersPublic(worldId: string, me: string, exclude: readonly string[]): SQL | undefined {
  return and(
    eq(posts.world_id, worldId),
    eq(posts.visibility, "public"),
    ne(posts.agent_id, me),
    exclude.length > 0 ? notInArray(posts.post_id, [...exclude]) : undefined,
  );
}

/** 優先 1：自分の投稿への返信で、自分がまだ返信していないもの（新しい順） */
export function loadRepliesToMe(db: DbOrTx, worldId: string, me: string, max: number): PostRow[] {
  const mine = alias(posts, "mine");
  const myReply = alias(posts, "my_reply");
  const replied = db
    .select({ one: sql`1` })
    .from(myReply)
    .where(and(eq(myReply.reply_to_post_id, posts.post_id), eq(myReply.agent_id, me)));
  const toMe = db
    .select({ one: sql`1` })
    .from(mine)
    .where(and(eq(mine.post_id, posts.reply_to_post_id), eq(mine.agent_id, me)));
  return selectPosts(db, and(othersPublic(worldId, me, []), exists(toMe), notExists(replied)), max);
}

/** 優先 2：フォロー中の住人の投稿（新しい順） */
export function loadFolloweePosts(
  db: DbOrTx,
  worldId: string,
  me: string,
  max: number,
  exclude: readonly string[],
): PostRow[] {
  return selectPosts(db, othersPublic(worldId, me, exclude), max, "followee", me);
}

/** 優先 3：世界全体の新しい投稿 */
export function loadRecentPosts(
  db: DbOrTx,
  worldId: string,
  me: string,
  max: number,
  exclude: readonly string[],
): PostRow[] {
  return selectPosts(db, othersPublic(worldId, me, exclude), max);
}

/**
 * 参照する投稿を max 件まで選ぶ。自分の投稿への返信（3）→ フォロー中の住人の投稿（5）→ 世界全体の新しい投稿（残り）。
 * 重複を除き、世界内時間の古い順に並べて P1 から番号を付ける
 */
export function selectRefPosts(db: DbOrTx, worldId: string, me: string, max: number): RefPost[] {
  const picked: PostRow[] = [];
  const ids = (): string[] => picked.map((p) => p.postId);
  const add = (rows: PostRow[]): void => {
    for (const row of rows) {
      if (picked.length < max && !ids().includes(row.postId)) picked.push(row);
    }
  };
  add(loadRepliesToMe(db, worldId, me, Math.min(MAX_REPLIES_TO_ME, max)));
  if (picked.length < max) {
    add(loadFolloweePosts(db, worldId, me, Math.min(MAX_FOLLOWEE_POSTS, max - picked.length), ids()));
  }
  if (picked.length < max) {
    add(loadRecentPosts(db, worldId, me, max - picked.length, ids()));
  }
  return numberRefs([...picked].sort((a, b) => a.worldTimeSec - b.worldTimeSec || (a.postId < b.postId ? -1 : 1)));
}

/** 並んだ順に P1 から番号を付け直す */
export function numberRefs(rows: readonly PostRow[]): RefPost[] {
  return rows.map((row, i) => ({ ...row, ref: `P${i + 1}` }));
}

/** 参照する投稿のうち、まだいいねしていないものの投稿 ID（参照する投稿は自分の投稿を含まない） */
export function loadLikeablePostIds(db: DbOrTx, me: string, refs: readonly RefPost[]): string[] {
  if (refs.length === 0) return [];
  const liked = new Set(
    db
      .select({ postId: likes.post_id })
      .from(likes)
      .where(
        and(
          eq(likes.agent_id, me),
          inArray(
            likes.post_id,
            refs.map((r) => r.postId),
          ),
        ),
      )
      .all()
      .map((row) => row.postId),
  );
  return refs.filter((r) => r.agentId !== me && !liked.has(r.postId)).map((r) => r.postId);
}

/** フォローできる住人：同じ世界の稼働中のエージェントで、自分以外で、フォローしていないもの（登録の順に 8 体まで） */
export function loadFollowTargets(db: DbOrTx, worldId: string, me: string): AgentRef[] {
  return db
    .select({ agentId: agents.agent_id, handle: agents.handle, displayName: agents.display_name })
    .from(agents)
    .leftJoin(
      follows,
      and(eq(follows.follower_id, me), eq(follows.followee_id, agents.agent_id), isNull(follows.ended_world_sec)),
    )
    .where(
      and(eq(agents.world_id, worldId), eq(agents.state, "active"), ne(agents.agent_id, me), isNull(follows.follow_id)),
    )
    .orderBy(asc(agents.created_at), asc(agents.agent_id))
    .limit(MAX_FOLLOW_TARGETS)
    .all();
}

/** フォロー中の住人（継続中のフォロー） */
export function loadFollowees(db: DbOrTx, worldId: string, me: string): AgentRef[] {
  return db
    .select({ agentId: agents.agent_id, handle: agents.handle, displayName: agents.display_name })
    .from(follows)
    .innerJoin(agents, eq(agents.agent_id, follows.followee_id))
    .where(and(eq(follows.world_id, worldId), eq(follows.follower_id, me), isNull(follows.ended_world_sec)))
    .orderBy(asc(follows.started_world_sec), asc(agents.handle))
    .all();
}

/** 1 回の行動機会の入力に使う文脈をまとめて読む */
export function loadContext(ctx: ContextInput, settings: ContextSettings): AgentContext {
  const { db, worldId, agentId } = ctx;
  const agent = loadAgent(db, worldId, agentId);
  const refs = selectRefPosts(db, worldId, agentId, settings.max_ref_posts);
  return {
    agent,
    memories: loadMemories(db, agentId),
    recentActions: loadRecentActions(db, worldId, agentId),
    refs,
    likeablePostIds: loadLikeablePostIds(db, agentId, refs),
    followTargets: loadFollowTargets(db, worldId, agentId),
    followees: loadFollowees(db, worldId, agentId),
  };
}
