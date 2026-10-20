// 招待リンクの一覧・発行・失効（BE 詳細設計 admin_auth 2章・3章・4章・6章）
import { desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import type { Clock } from "../../clock/clock";
import type { Db } from "../../db/client";
import { invitations } from "../../db/schema";
import { withTx, type DbOrTx } from "../../db/tx";
import { AppError } from "../../lib/errors";
import { newUlid } from "../../lib/ids";
import { randomToken, sha256Hex } from "../../lib/tokens";
import { recordAudit } from "../audit/auditService";
import type { AdminSession } from "../context";
import { getLanAddress as defaultGetLanAddress } from "./lanAddress";

/** 失効していない招待の上限（Q-105） */
export const MAX_ACTIVE_INVITATIONS = 5;

export const MAX_ACTIVE_INVITATIONS_MESSAGE = "招待は 5 名までです。使わない招待を失効させてから発行してください";

export const issueInvitationBodySchema = z.object({
  label: z.string().trim().min(1, "1〜30 字で入力してください").max(30, "1〜30 字で入力してください"),
});

export interface InvitationItem {
  invitationId: string;
  label: string;
  issuedAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
}

export interface InvitationListResult {
  items: InvitationItem[];
  lanAddress: string | null;
}

export interface IssueInvitationDeps {
  db: Db;
  clock: Clock;
  admin: AdminSession;
  observerPort: number;
  getLanAddress?: () => string | null;
}

export interface IssueInvitationResult {
  invitationId: string;
  inviteUrl: string;
}

export interface RevokeInvitationDeps {
  db: Db;
  clock: Clock;
  admin: AdminSession;
}

export interface RevokeInvitationResult {
  invitationId: string;
  revokedAt: string;
}

/** invitations を issued_at の新しい順に全件読む（3章 listInvitations） */
export function listInvitations(db: DbOrTx): InvitationItem[] {
  return db
    .select({
      invitationId: invitations.invitation_id,
      label: invitations.label,
      issuedAt: invitations.issued_at,
      revokedAt: invitations.revoked_at,
      lastUsedAt: invitations.last_used_at,
    })
    .from(invitations)
    .orderBy(desc(invitations.issued_at))
    .all();
}

/** invitation_id で invitations を1行読む（3章 findInvitationById） */
export function findInvitationById(db: DbOrTx, invitationId: string) {
  return db.select().from(invitations).where(eq(invitations.invitation_id, invitationId)).get();
}

/** 招待の一覧と LAN アドレスを返す（4章 listInvitationsWithLan） */
export function listInvitationsWithLan(
  db: DbOrTx,
  resolveLanAddress: () => string | null = defaultGetLanAddress,
): InvitationListResult {
  const items = listInvitations(db);
  const lanAddress = resolveLanAddress();
  return { items, lanAddress };
}

/**
 * 招待リンクを発行する（4章 issueInvitation）。
 * 平文のトークンは DB にも監査ログにも保存せず、応答の inviteUrl にだけ含める。
 */
export function issueInvitation(deps: IssueInvitationDeps, rawLabel: string): IssueInvitationResult {
  const { label } = issueInvitationBodySchema.parse({ label: rawLabel });
  const resolveLanAddress = deps.getLanAddress ?? defaultGetLanAddress;
  const lanAddress = resolveLanAddress();
  if (!lanAddress) {
    throw new AppError("LAN_ADDRESS_NOT_FOUND");
  }

  const token = randomToken(32);
  const tokenHash = sha256Hex(token);

  const invitationId = withTx(deps.db, (tx) => {
    const activeRows = tx
      .select({ id: invitations.invitation_id })
      .from(invitations)
      .where(isNull(invitations.revoked_at))
      .all();
    if (activeRows.length >= MAX_ACTIVE_INVITATIONS) {
      throw new AppError("CONFLICT", { message: MAX_ACTIVE_INVITATIONS_MESSAGE });
    }

    const id = newUlid(deps.clock.nowMs());
    const issuedAt = deps.clock.nowIso();
    tx.insert(invitations)
      .values({
        invitation_id: id,
        label,
        token_hash: tokenHash,
        issued_at: issuedAt,
        revoked_at: null,
        last_used_at: null,
      })
      .run();

    recordAudit(tx, deps.clock, {
      adminId: deps.admin.adminId,
      operation: "invitation.issue",
      targetType: "invitation",
      targetId: id,
      after: { invitationId: id, label },
    });

    return id;
  });

  const inviteUrl = `http://${lanAddress}:${deps.observerPort}/invite/${token}`;
  return { invitationId, inviteUrl };
}

/** 招待を失効させる（4章 revokeInvitation） */
export function revokeInvitation(deps: RevokeInvitationDeps, invitationId: string): RevokeInvitationResult {
  if (invitationId.length !== 26) {
    throw new AppError("VALIDATION_ERROR", {
      fields: { invitationId: "招待 ID は 26 字で指定してください" },
    });
  }

  return withTx(deps.db, (tx) => {
    const existing = findInvitationById(tx, invitationId);
    if (!existing) {
      throw new AppError("INVITATION_NOT_FOUND");
    }
    if (existing.revoked_at !== null) {
      throw new AppError("ALREADY_REVOKED");
    }

    const revokedAt = deps.clock.nowIso();
    tx.update(invitations).set({ revoked_at: revokedAt }).where(eq(invitations.invitation_id, invitationId)).run();

    recordAudit(tx, deps.clock, {
      adminId: deps.admin.adminId,
      operation: "invitation.revoke",
      targetType: "invitation",
      targetId: invitationId,
      before: { revokedAt: null },
      after: { revokedAt },
    });

    return { invitationId, revokedAt };
  });
}
