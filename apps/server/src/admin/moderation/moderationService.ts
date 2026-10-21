// 投稿の非表示・再表示と履歴（BE 詳細設計 admin_data 2章・3章・4章・6章、NOUS-66）
// posts の UPDATE・hide_records の INSERT・recordAudit は 1 つの withTx の中で行い、どれかが失敗したら全部取り消す
import type { HideRecordItem, HideRecordListResponse, PostHideResponse, PostUnhideResponse } from "@nous/shared";
import { and, desc, eq, lt, or } from "drizzle-orm";
import type { Clock } from "../../clock/clock";
import type { Db } from "../../db/client";
import { hide_records, posts } from "../../db/schema";
import { withTx } from "../../db/tx";
import { decodeCursor, encodeCursor } from "../../lib/cursor";
import { AppError } from "../../lib/errors";
import { newUlid } from "../../lib/ids";
import { findCurrentWorld } from "../../world/worldService";
import { recordAudit } from "../audit/auditService";

/** 操作した管理者（AdminSession のうち監査に使う項目） */
export interface ModerationAdmin {
  adminId: string;
}

export interface HideHistoryQuery {
  cursor?: string;
  limit: number;
}

/** postBodyExcerpt に使う本文の文字数（サロゲートペアを壊さないよう文字単位で数える） */
const EXCERPT_CHARS = 40;

type HideOperationName = "hide" | "unhide";

interface ToggleSpec {
  operation: HideOperationName;
  /** 操作の前に必要な visibility（満たさなければ conflictCode） */
  from: "public" | "hidden";
  to: "public" | "hidden";
  conflictCode: "ALREADY_HIDDEN" | "NOT_HIDDEN";
  auditOperation: "post.hide" | "post.unhide";
}

const HIDE_SPEC: ToggleSpec = {
  operation: "hide",
  from: "public",
  to: "hidden",
  conflictCode: "ALREADY_HIDDEN",
  auditOperation: "post.hide",
};

const UNHIDE_SPEC: ToggleSpec = {
  operation: "unhide",
  from: "hidden",
  to: "public",
  conflictCode: "NOT_HIDDEN",
  auditOperation: "post.unhide",
};

/**
 * hidePost・unhidePost の共通の流れ。1 つのトランザクションで、現在の世界の投稿を読み、
 * visibility の更新・hide_records の追加・監査の記録を行う
 */
function toggleVisibility(
  db: Db,
  clock: Clock,
  postId: string,
  reason: string | undefined,
  admin: ModerationAdmin,
  spec: ToggleSpec,
): void {
  withTx(db, (tx) => {
    const world = findCurrentWorld(tx);
    if (!world) {
      throw new AppError("POST_NOT_FOUND");
    }
    const post = tx
      .select({ post_id: posts.post_id, visibility: posts.visibility })
      .from(posts)
      .where(and(eq(posts.post_id, postId), eq(posts.world_id, world.world_id)))
      .get();
    if (!post) {
      throw new AppError("POST_NOT_FOUND");
    }
    if (post.visibility !== spec.from) {
      throw new AppError(spec.conflictCode);
    }

    const reasonText = reason ?? "";

    tx.update(posts).set({ visibility: spec.to }).where(eq(posts.post_id, postId)).run();
    tx.insert(hide_records)
      .values({
        hide_id: newUlid(clock.nowMs()),
        post_id: postId,
        operation: spec.operation,
        reason: reasonText,
        operated_at: clock.nowIso(),
      })
      .run();
    recordAudit(tx, clock, {
      adminId: admin.adminId,
      operation: spec.auditOperation,
      targetType: "post",
      targetId: postId,
      before: { visibility: spec.from },
      after: { visibility: spec.to, reason: reasonText },
      worldId: world.world_id,
    });
  });
}

/** 4章 hidePost：現在の世界の公開中の投稿を非表示にする。ない・別の世界は 404、すでに非表示は 409 */
export function hidePost(
  db: Db,
  clock: Clock,
  postId: string,
  reason: string | undefined,
  admin: ModerationAdmin,
): PostHideResponse {
  toggleVisibility(db, clock, postId, reason, admin, HIDE_SPEC);
  return { postId, visibility: "hidden" };
}

/** 4章 unhidePost：現在の世界の非表示の投稿を公開に戻す。ない・別の世界は 404、非表示でなければ 409 */
export function unhidePost(
  db: Db,
  clock: Clock,
  postId: string,
  reason: string | undefined,
  admin: ModerationAdmin,
): PostUnhideResponse {
  toggleVisibility(db, clock, postId, reason, admin, UNHIDE_SPEC);
  return { postId, visibility: "public" };
}

/** カーソル（[operated_at, hide_id]）を復号する。2 要素でない・operated_at が日時でないなら 400 */
function decodeHideCursor(cursor: string): { operatedAt: string; hideId: string } {
  const values = decodeCursor(cursor);
  const [operatedAt, hideId] = values;
  if (
    values.length !== 2 ||
    operatedAt === undefined ||
    hideId === undefined ||
    hideId === "" ||
    Number.isNaN(Date.parse(operatedAt))
  ) {
    throw new AppError("VALIDATION_ERROR", { fields: { cursor: "カーソルが正しくありません" } });
  }
  return { operatedAt, hideId };
}

/** 本文の先頭 40 字（文字単位） */
function excerpt(body: string): string {
  return Array.from(body).slice(0, EXCERPT_CHARS).join("");
}

/**
 * 4章 listHideHistory：現在の世界の投稿の hide_records を新しい順（operated_at DESC, hide_id DESC）に limit 件まで返す。
 * 現在の世界がなければ空。limit+1 件読み、あまりがあれば最後に返す行から nextCursor を作る
 */
export function listHideHistory(db: Db, query: HideHistoryQuery): HideRecordListResponse {
  const world = findCurrentWorld(db);
  if (!world) {
    return { items: [], nextCursor: null };
  }

  const conditions = [eq(posts.world_id, world.world_id)];
  if (query.cursor !== undefined) {
    const c = decodeHideCursor(query.cursor);
    const older = or(
      lt(hide_records.operated_at, c.operatedAt),
      and(eq(hide_records.operated_at, c.operatedAt), lt(hide_records.hide_id, c.hideId)),
    );
    if (older) {
      conditions.push(older);
    }
  }

  const rows = db
    .select({
      hide_id: hide_records.hide_id,
      post_id: hide_records.post_id,
      operation: hide_records.operation,
      reason: hide_records.reason,
      operated_at: hide_records.operated_at,
      body: posts.body,
    })
    .from(hide_records)
    .innerJoin(posts, eq(hide_records.post_id, posts.post_id))
    .where(and(...conditions))
    .orderBy(desc(hide_records.operated_at), desc(hide_records.hide_id))
    .limit(query.limit + 1)
    .all();

  const hasMore = rows.length > query.limit;
  const page = hasMore ? rows.slice(0, query.limit) : rows;
  const last = page[page.length - 1];

  const items: HideRecordItem[] = page.map((row) => ({
    hideId: row.hide_id,
    postId: row.post_id,
    operation: row.operation,
    reason: row.reason,
    operatedAt: row.operated_at,
    postBodyExcerpt: excerpt(row.body),
  }));

  return {
    items,
    nextCursor: hasMore && last ? encodeCursor([last.operated_at, last.hide_id]) : null,
  };
}
