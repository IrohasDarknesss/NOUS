// スレッドの取得と木の組み立て（BE 詳細設計 observer 2〜4章 threadService.ts）
import type { ThreadNode, ThreadView } from "@nous/shared";
import { and, asc, eq } from "drizzle-orm";
import { agents, posts } from "../../db/schema";
import type { DbOrTx } from "../../db/tx";
import { AppError } from "../../lib/errors";
import { toThreadNode, type ThreadPostRow } from "../mappers";
import { countLikes, mustGetCurrentWorld } from "./timelineService";

/** root_post_id が一致する投稿を world_time_sec, post_id の昇順ですべて読む（agents は LEFT JOIN） */
export function selectThreadPosts(db: DbOrTx, worldId: string, rootPostId: string): ThreadPostRow[] {
  const rows = db
    .select({
      post_id: posts.post_id,
      body: posts.body,
      visibility: posts.visibility,
      world_time_sec: posts.world_time_sec,
      reply_to_post_id: posts.reply_to_post_id,
      agent_id: agents.agent_id,
      handle: agents.handle,
      display_name: agents.display_name,
      state: agents.state,
    })
    .from(posts)
    .leftJoin(agents, eq(agents.agent_id, posts.agent_id))
    .where(and(eq(posts.world_id, worldId), eq(posts.root_post_id, rootPostId)))
    .orderBy(asc(posts.world_time_sec), asc(posts.post_id))
    .all();

  return rows.map((r) => ({
    post_id: r.post_id,
    body: r.body,
    visibility: r.visibility,
    world_time_sec: r.world_time_sec,
    reply_to_post_id: r.reply_to_post_id,
    agent:
      r.agent_id !== null && r.handle !== null && r.display_name !== null && r.state !== null
        ? {
            agent_id: r.agent_id,
            handle: r.handle,
            display_name: r.display_name,
            state: r.state,
          }
        : null,
  }));
}

/**
 * スレッドの行から rootId を起点（段数 0）として深さ depth までの木を作る。
 * 段数が depth の節では children を空にし、moreCount にその子孫の総数を入れる
 */
export function buildTree(
  rows: readonly ThreadPostRow[],
  rootId: string,
  depth: number,
  likeCounts: ReadonlyMap<string, number> = new Map(),
): ThreadNode {
  const byId = new Map<string, ThreadPostRow>();
  const childrenByParent = new Map<string, ThreadPostRow[]>();

  const sorted = [...rows].sort(
    (a, b) => a.world_time_sec - b.world_time_sec || (a.post_id < b.post_id ? -1 : a.post_id > b.post_id ? 1 : 0),
  );

  for (const row of sorted) {
    byId.set(row.post_id, row);
    if (row.reply_to_post_id !== null) {
      const list = childrenByParent.get(row.reply_to_post_id);
      if (list) {
        list.push(row);
      } else {
        childrenByParent.set(row.reply_to_post_id, [row]);
      }
    }
  }

  const rootRow = byId.get(rootId);
  if (!rootRow) {
    throw new AppError("POST_NOT_FOUND");
  }

  const countDescendants = (postId: string): number => {
    const direct = childrenByParent.get(postId) ?? [];
    let total = direct.length;
    for (const child of direct) {
      total += countDescendants(child.post_id);
    }
    return total;
  };

  const buildNode = (row: ThreadPostRow, currentDepth: number): ThreadNode => {
    const likeCount = likeCounts.get(row.post_id) ?? 0;
    if (currentDepth >= depth) {
      return toThreadNode(row, [], {
        likeCount,
        moreCount: countDescendants(row.post_id),
      });
    }
    const direct = childrenByParent.get(row.post_id) ?? [];
    const children = direct.map((child) => buildNode(child, currentDepth + 1));
    return toThreadNode(row, children, {
      likeCount,
      moreCount: 0,
    });
  };

  return buildNode(rootRow, 0);
}

/** スレッドの木に含まれるすべての投稿 ID を集める */
function collectNodePostIds(node: ThreadNode): string[] {
  const ids: string[] = [node.postId];
  for (const child of node.children) {
    ids.push(...collectNodePostIds(child));
  }
  return ids;
}

/** 木の各節にいいね数を反映する */
function applyLikeCounts(node: ThreadNode, likeCounts: ReadonlyMap<string, number>): ThreadNode {
  return {
    ...node,
    likeCount: likeCounts.get(node.postId) ?? 0,
    children: node.children.map((child) => applyLikeCounts(child, likeCounts)),
  };
}

/** GET /api/posts/:postId/thread：スレッドを起点から深さ depth まで返す */
export function getThread(db: DbOrTx, params: { postId: string; depth: number; from?: string }): ThreadView {
  const world = mustGetCurrentWorld(db);

  const focusPost = db
    .select({ post_id: posts.post_id, root_post_id: posts.root_post_id })
    .from(posts)
    .where(and(eq(posts.post_id, params.postId), eq(posts.world_id, world.world_id)))
    .get();
  if (!focusPost) {
    throw new AppError("POST_NOT_FOUND");
  }

  let startPostId = focusPost.root_post_id;
  if (params.from !== undefined) {
    const fromPost = db
      .select({ post_id: posts.post_id, root_post_id: posts.root_post_id })
      .from(posts)
      .where(
        and(
          eq(posts.post_id, params.from),
          eq(posts.world_id, world.world_id),
          eq(posts.root_post_id, focusPost.root_post_id),
        ),
      )
      .get();
    if (!fromPost) {
      throw new AppError("POST_NOT_FOUND");
    }
    startPostId = fromPost.post_id;
  }

  const rows = selectThreadPosts(db, world.world_id, focusPost.root_post_id);
  const tree = buildTree(rows, startPostId, params.depth);
  const likeCounts = countLikes(db, collectNodePostIds(tree));
  const root = applyLikeCounts(tree, likeCounts);

  return {
    root,
    focusPostId: params.postId,
  };
}
