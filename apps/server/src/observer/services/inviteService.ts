// 招待の照合と閲覧の記録（BE 詳細設計 observer 2章 GET /invite/:token、3章、4章 checkInvitation・acceptInvite、6章）
import { InviteParamsSchema } from "@nous/shared";
import { eq } from "drizzle-orm";
import type { Db } from "../../db/client";
import { invitations, view_access_logs } from "../../db/schema";
import { withTx, type DbOrTx } from "../../db/tx";
import { newUlid } from "../../lib/ids";
import type { Logger } from "../../lib/logger";
import { sha256Hex } from "../../lib/tokens";

export type Invitation = typeof invitations.$inferSelect;
export type ViewResult = (typeof view_access_logs.$inferInsert)["result"];

/** 招待トークンの形（43 字の Base64URL）か */
export function isInviteTokenFormat(token: string): boolean {
  return InviteParamsSchema.safeParse({ token }).success;
}

/** token_hash で招待を引く（UNIQUE） */
export function findInvitationByHash(db: DbOrTx, tokenHash: string): Invitation | null {
  return db.select().from(invitations).where(eq(invitations.token_hash, tokenHash)).get() ?? null;
}

/** 閲覧の記録を1行残す */
export function insertViewLog(
  db: DbOrTx,
  entry: { invitationId: string | null; result: ViewResult; accessedAt: string },
): void {
  db.insert(view_access_logs)
    .values({
      log_id: newUlid(Date.parse(entry.accessedAt)),
      invitation_id: entry.invitationId,
      result: entry.result,
      accessed_at: entry.accessedAt,
    })
    .run();
}

/** 有効な招待を返す。形が不正・見つからない・失効していれば null */
export function checkInvitation(db: DbOrTx, token: string): Invitation | null {
  if (!isInviteTokenFormat(token)) return null;
  const invitation = findInvitationByHash(db, sha256Hex(token));
  if (!invitation || invitation.revoked_at !== null) return null;
  return invitation;
}

/**
 * 招待リンクを受け付ける。now は ISO 8601（clock.nowIso()）。
 * 成功：last_used_at の更新と allowed の記録を1つのトランザクションで行う。
 * 失敗：denied を記録する（失効なら invitation_id を入れる）。記録に失敗しても ok: false を返す。
 * 失敗の理由（形・なし・失効）は戻り値で区別しない（P106 の業務ルール）
 */
export function acceptInvite(db: Db, token: string, now: string, logger?: Logger): { ok: boolean } {
  const found = isInviteTokenFormat(token) ? findInvitationByHash(db, sha256Hex(token)) : null;

  if (found && found.revoked_at === null) {
    withTx(db, (tx) => {
      tx.update(invitations).set({ last_used_at: now }).where(eq(invitations.invitation_id, found.invitation_id)).run();
      insertViewLog(tx, { invitationId: found.invitation_id, result: "allowed", accessedAt: now });
    });
    return { ok: true };
  }

  try {
    insertViewLog(db, { invitationId: found?.invitation_id ?? null, result: "denied", accessedAt: now });
  } catch (err) {
    logger?.error("observer: 閲覧の記録（denied）に失敗", { err });
  }
  return { ok: false };
}
