// 行動の反映（BE 詳細設計 generation 4章 applyAction、行動生成とプロンプトの設計 7章）。
// commitAction のトランザクションの中で呼ぶ（NFR-A-006）。UNIQUE の違反は DuplicateActionError にする（6章）。
import { and, eq, isNull, sql } from "drizzle-orm";
import { daily_metrics, follows, likes, posts } from "../db/schema";
import type { Tx } from "../db/tx";
import { newUlid } from "../lib/ids";
import type { ValidAction } from "./actionValidator";

/** 多重実行・再試行で同じ行動を 2 回反映しようとした（6章。failed（invalid_format）で閉じ、error_detail に残す） */
export class DuplicateActionError extends Error {
  /** 違反した制約（例 'likes.agent_id, likes.post_id'、'unfollow_without_follow'） */
  readonly constraint: string;

  constructor(constraint: string, options?: { cause?: unknown }) {
    super(`同じ行動がすでに反映されています: ${constraint}`, options);
    this.name = "DuplicateActionError";
    this.constraint = constraint;
  }

  /** generation_attempts.error_detail に残す文字列 */
  get errorDetail(): string {
    return `duplicate_action ${this.constraint}`;
  }
}

/** 反映に要る文脈 */
export type ApplyContext = {
  worldId: string;
  agentId: string;
  /** 世界内時間（生成イベントの world_time_sec と同じ値） */
  worldTimeSec: number;
  /** Clock の現在時刻（ISO 8601） */
  nowIso: string;
  /** daily_metrics の日付（clock の UTC の日付、YYYY-MM-DD） */
  usageDate: string;
};

export type AppliedAction =
  | { action: "post"; postId: string }
  | {
      action: "reply";
      postId: string;
      replyToPostId: string;
      rootPostId: string;
      depth: number;
      firstReplyToday: boolean;
    }
  | { action: "like"; likeId: string; postId: string }
  | { action: "follow"; followId: string; followeeId: string }
  | { action: "unfollow"; followId: string; followeeId: string }
  | { action: "none" };

/** SQLite の UNIQUE・PRIMARY KEY の違反なら、違反した列を返す */
function uniqueViolation(e: unknown): string | null {
  const code = (e as { code?: unknown } | null)?.code;
  if (code !== "SQLITE_CONSTRAINT_UNIQUE" && code !== "SQLITE_CONSTRAINT_PRIMARYKEY") {
    return null;
  }
  const message = e instanceof Error ? e.message : "";
  const m = /constraint failed: (.+)$/.exec(message);
  return m?.[1] ?? String(code);
}

function guardUnique<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    const constraint = uniqueViolation(e);
    if (constraint !== null) {
      throw new DuplicateActionError(constraint, { cause: e });
    }
    throw e;
  }
}

/** 対象が今日の投稿で、返信が初めてなら daily_metrics.replied_posts を加算する（7章） */
function countRepliedPost(tx: Tx, ctx: ApplyContext, target: { post_id: string; created_at: string }): boolean {
  if (target.created_at.slice(0, 10) !== ctx.usageDate) {
    return false;
  }
  const existing = tx
    .select({ n: sql<number>`count(*)` })
    .from(posts)
    .where(eq(posts.reply_to_post_id, target.post_id))
    .get();
  if ((existing?.n ?? 0) > 0) {
    return false;
  }
  tx.insert(daily_metrics)
    .values({ world_id: ctx.worldId, usage_date: ctx.usageDate, replied_posts: 1 })
    .onConflictDoUpdate({
      target: [daily_metrics.world_id, daily_metrics.usage_date],
      set: { replied_posts: sql`${daily_metrics.replied_posts} + 1` },
    })
    .run();
  return true;
}

/** 検証済みの行動を反映する */
export function applyAction(tx: Tx, eventId: string, action: ValidAction, ctx: ApplyContext): AppliedAction {
  switch (action.action) {
    case "none":
      return { action: "none" };

    case "post": {
      const postId = newUlid();
      guardUnique(() =>
        tx
          .insert(posts)
          .values({
            post_id: postId,
            world_id: ctx.worldId,
            agent_id: ctx.agentId,
            body: action.text,
            reply_to_post_id: null,
            root_post_id: postId,
            depth: 0,
            world_time_sec: ctx.worldTimeSec,
            created_at: ctx.nowIso,
            generation_event_id: eventId,
          })
          .run(),
      );
      return { action: "post", postId };
    }

    case "reply": {
      const target = tx
        .select({
          post_id: posts.post_id,
          root_post_id: posts.root_post_id,
          depth: posts.depth,
          created_at: posts.created_at,
          world_id: posts.world_id,
        })
        .from(posts)
        .where(eq(posts.post_id, action.targetPostId))
        .get();
      if (target === undefined || target.world_id !== ctx.worldId) {
        // 検証の後に消えることはない（投稿は消さない）が、別の世界を指すことは許さない
        throw new Error(`返信先の投稿が同じ世界にありません: ${action.targetPostId}`);
      }
      // 返信を入れる前に数える（入れた後だと自分の返信が数に入る）
      const firstReplyToday = countRepliedPost(tx, ctx, target);
      const postId = newUlid();
      const depth = target.depth + 1;
      guardUnique(() =>
        tx
          .insert(posts)
          .values({
            post_id: postId,
            world_id: ctx.worldId,
            agent_id: ctx.agentId,
            body: action.text,
            reply_to_post_id: target.post_id,
            root_post_id: target.root_post_id,
            depth,
            world_time_sec: ctx.worldTimeSec,
            created_at: ctx.nowIso,
            generation_event_id: eventId,
          })
          .run(),
      );
      return {
        action: "reply",
        postId,
        replyToPostId: target.post_id,
        rootPostId: target.root_post_id,
        depth,
        firstReplyToday,
      };
    }

    case "like": {
      const likeId = newUlid();
      guardUnique(() =>
        tx
          .insert(likes)
          .values({
            like_id: likeId,
            world_id: ctx.worldId,
            agent_id: ctx.agentId,
            post_id: action.targetPostId,
            world_time_sec: ctx.worldTimeSec,
            created_at: ctx.nowIso,
            generation_event_id: eventId,
          })
          .run(),
      );
      return { action: "like", likeId, postId: action.targetPostId };
    }

    case "follow": {
      const followId = newUlid();
      guardUnique(() =>
        tx
          .insert(follows)
          .values({
            follow_id: followId,
            world_id: ctx.worldId,
            follower_id: ctx.agentId,
            followee_id: action.targetAgentId,
            started_world_sec: ctx.worldTimeSec,
            start_event_id: eventId,
          })
          .run(),
      );
      return { action: "follow", followId, followeeId: action.targetAgentId };
    }

    case "unfollow": {
      const ended = tx
        .update(follows)
        .set({ ended_world_sec: ctx.worldTimeSec, end_event_id: eventId })
        .where(
          and(
            eq(follows.follower_id, ctx.agentId),
            eq(follows.followee_id, action.targetAgentId),
            isNull(follows.ended_world_sec),
          ),
        )
        .returning({ follow_id: follows.follow_id })
        .all();
      const row = ended[0];
      if (row === undefined) {
        // 検証の後に別の生成が先に解除した（多重実行）
        throw new DuplicateActionError("unfollow_without_follow");
      }
      return { action: "unfollow", followId: row.follow_id, followeeId: action.targetAgentId };
    }
  }
}
