import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { TEST_ADMIN_ID, TEST_NOW, seedAdmin } from "../../../test/helpers/adminTestSupport";
import { createTestDb, type TestDb } from "../../../test/helpers/testDb";
import { FakeClock } from "../../clock/fakeClock";
import { admin_audit_logs, invitations } from "../../db/schema";
import { AppError } from "../../lib/errors";
import { sha256Hex } from "../../lib/tokens";
import type { AdminSession } from "../context";
import {
  MAX_ACTIVE_INVITATIONS,
  MAX_ACTIVE_INVITATIONS_MESSAGE,
  findInvitationById,
  issueInvitation,
  listInvitationsWithLan,
  revokeInvitation,
} from "./invitationService";

const adminSession: AdminSession = {
  adminId: TEST_ADMIN_ID,
  displayName: "Kaine Yamashiro",
  csrfToken: "csrf-token-value-123456789012345678901234567",
  sessionHash: "a".repeat(64),
  createdAt: TEST_NOW.toISOString(),
};

describe("invitationService", () => {
  let t: TestDb;
  let clock: FakeClock;

  beforeEach(() => {
    t = createTestDb();
    clock = new FakeClock(TEST_NOW);
    seedAdmin(t.db, TEST_NOW);
  });

  afterEach(() => {
    t.cleanup();
  });

  it("TC-NOUS54_DEV-05 listInvitationsWithLan が issued_at の新しい順に全件返し、lanAddress（文字列または null）を含める", () => {
    t.db
      .insert(invitations)
      .values([
        {
          invitation_id: "01JB00000000000000000INV01",
          label: "ひとり目",
          token_hash: "1".repeat(64),
          issued_at: "2026-10-20T00:00:00.000Z",
          revoked_at: null,
          last_used_at: null,
        },
        {
          invitation_id: "01JB00000000000000000INV02",
          label: "ふたり目",
          token_hash: "2".repeat(64),
          issued_at: "2026-10-20T01:00:00.000Z",
          revoked_at: "2026-10-20T02:00:00.000Z",
          last_used_at: "2026-10-20T01:30:00.000Z",
        },
      ])
      .run();

    const withLan = listInvitationsWithLan(t.db, () => "192.168.1.10");
    expect(withLan).toEqual({
      items: [
        {
          invitationId: "01JB00000000000000000INV02",
          label: "ふたり目",
          issuedAt: "2026-10-20T01:00:00.000Z",
          revokedAt: "2026-10-20T02:00:00.000Z",
          lastUsedAt: "2026-10-20T01:30:00.000Z",
        },
        {
          invitationId: "01JB00000000000000000INV01",
          label: "ひとり目",
          issuedAt: "2026-10-20T00:00:00.000Z",
          revokedAt: null,
          lastUsedAt: null,
        },
      ],
      lanAddress: "192.168.1.10",
    });

    const withoutLan = listInvitationsWithLan(t.db, () => null);
    expect(withoutLan.lanAddress).toBeNull();
    expect(withoutLan.items).toHaveLength(2);
  });

  it("TC-NOUS54_DEV-06 issueInvitation がトークンの sha256Hex のみを DB に保存し、監査ログにトークンやハッシュを含めず inviteUrl を返す", () => {
    const res = issueInvitation(
      {
        db: t.db,
        clock,
        admin: adminSession,
        observerPort: 8080,
        getLanAddress: () => "192.168.1.10",
      },
      "たなか",
    );

    const prefix = "http://192.168.1.10:8080/invite/";
    expect(res.inviteUrl.startsWith(prefix)).toBe(true);
    const token = res.inviteUrl.slice(prefix.length);
    expect(token).toHaveLength(43);

    const row = findInvitationById(t.db, res.invitationId);
    expect(row).toEqual({
      invitation_id: res.invitationId,
      label: "たなか",
      token_hash: sha256Hex(token),
      issued_at: TEST_NOW.toISOString(),
      revoked_at: null,
      last_used_at: null,
    });
    expect(JSON.stringify(row)).not.toContain(token);

    const audit = t.db.select().from(admin_audit_logs).get();
    expect(audit).toMatchObject({
      admin_id: TEST_ADMIN_ID,
      operation: "invitation.issue",
      target_type: "invitation",
      target_id: res.invitationId,
      before_json: null,
      after_json: JSON.stringify({ invitationId: res.invitationId, label: "たなか" }),
      operated_at: TEST_NOW.toISOString(),
    });
    expect(JSON.stringify(audit)).not.toContain(token);
    expect(JSON.stringify(audit)).not.toContain(sha256Hex(token));
  });

  it("TC-NOUS54_DEV-07 issueInvitation は label の前後の空白を取り除いて 1〜30 字であれば発行でき、空・空白のみ・31 字以上は失敗する", () => {
    const deps = {
      db: t.db,
      clock,
      admin: adminSession,
      observerPort: 8080,
      getLanAddress: () => "192.168.1.10",
    };

    const trimmed = issueInvitation(deps, `  ${"あ".repeat(30)}  `);
    expect(findInvitationById(t.db, trimmed.invitationId)?.label).toBe("あ".repeat(30));

    for (const bad of ["", "   ", "\t\n", "あ".repeat(31)]) {
      expect(() => issueInvitation(deps, bad)).toThrow(ZodError);
    }
  });

  it("TC-NOUS54_DEV-08 issueInvitation は未失効の招待が 5 件あると 409 CONFLICT になり、失効済みの招待は上限に数えない", () => {
    const deps = {
      db: t.db,
      clock,
      admin: adminSession,
      observerPort: 8080,
      getLanAddress: () => "192.168.1.10",
    };

    const issuedIds: string[] = [];
    for (let i = 0; i < MAX_ACTIVE_INVITATIONS; i += 1) {
      const r = issueInvitation(deps, `招待${i + 1}`);
      issuedIds.push(r.invitationId);
    }

    try {
      issueInvitation(deps, "6人目");
      expect.unreachable("5 件の上限を超える発行は失敗するはず");
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      const appErr = err as AppError;
      expect(appErr.code).toBe("CONFLICT");
      expect(appErr.status).toBe(409);
      expect(appErr.message).toBe(MAX_ACTIVE_INVITATIONS_MESSAGE);
    }

    const firstId = issuedIds[0]!;
    revokeInvitation({ db: t.db, clock, admin: adminSession }, firstId);

    const sixth = issueInvitation(deps, "失効後の発行");
    expect(sixth.invitationId).toHaveLength(26);
  });

  it("TC-NOUS54_DEV-09 issueInvitation は LAN アドレスが null のとき 409 LAN_ADDRESS_NOT_FOUND を投げ、DB にも監査ログにも行を増やさない", () => {
    expect(() =>
      issueInvitation(
        {
          db: t.db,
          clock,
          admin: adminSession,
          observerPort: 8080,
          getLanAddress: () => null,
        },
        "たなか",
      ),
    ).toThrowError(expect.objectContaining({ code: "LAN_ADDRESS_NOT_FOUND", status: 409 }));

    expect(t.db.select().from(invitations).all()).toHaveLength(0);
    expect(t.db.select().from(admin_audit_logs).all()).toHaveLength(0);
  });

  it("TC-NOUS54_DEV-10 revokeInvitation が revoked_at を更新し、同じトランザクションで invitation.revoke の監査ログを残す", async () => {
    const issued = issueInvitation(
      {
        db: t.db,
        clock,
        admin: adminSession,
        observerPort: 8080,
        getLanAddress: () => "192.168.1.10",
      },
      "たなか",
    );

    await clock.advance(60_000);
    const revoked = revokeInvitation({ db: t.db, clock, admin: adminSession }, issued.invitationId);

    expect(revoked).toEqual({
      invitationId: issued.invitationId,
      revokedAt: clock.nowIso(),
    });
    expect(findInvitationById(t.db, issued.invitationId)?.revoked_at).toBe(clock.nowIso());

    const audits = t.db.select().from(admin_audit_logs).all();
    expect(audits).toHaveLength(2);
    const revokeAudit = audits.find((a) => a.operation === "invitation.revoke");
    expect(revokeAudit).toMatchObject({
      admin_id: TEST_ADMIN_ID,
      operation: "invitation.revoke",
      target_type: "invitation",
      target_id: issued.invitationId,
      before_json: JSON.stringify({ revokedAt: null }),
      after_json: JSON.stringify({ revokedAt: clock.nowIso() }),
      operated_at: clock.nowIso(),
    });
  });

  it("TC-NOUS54_DEV-11 revokeInvitation は存在しない ID で 404 INVITATION_NOT_FOUND、失効済みで 409 ALREADY_REVOKED、26 字以外の ID で 400 VALIDATION_ERROR を投げる", () => {
    const deps = { db: t.db, clock, admin: adminSession };

    expect(() => revokeInvitation(deps, "short-id")).toThrowError(
      expect.objectContaining({ code: "VALIDATION_ERROR", status: 400 }),
    );

    expect(() => revokeInvitation(deps, "01JB000000000000000UNKNOWN")).toThrowError(
      expect.objectContaining({ code: "INVITATION_NOT_FOUND", status: 404 }),
    );

    const issued = issueInvitation(
      {
        ...deps,
        observerPort: 8080,
        getLanAddress: () => "192.168.1.10",
      },
      "たなか",
    );
    revokeInvitation(deps, issued.invitationId);

    expect(() => revokeInvitation(deps, issued.invitationId)).toThrowError(
      expect.objectContaining({ code: "ALREADY_REVOKED", status: 409 }),
    );
  });
});
