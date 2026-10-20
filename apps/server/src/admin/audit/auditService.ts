// 管理操作履歴の記録（BE 詳細設計 admin_auth 4章 recordAudit、6章「セキュリティの補足」、NFR-S-008）
// 変更を行う管理 API のすべてから、変更と同じトランザクション（withTx の tx）の中で呼ぶ
import type { Clock } from "../../clock/clock";
import { admin_audit_logs, type AUDIT_OPERATIONS, type AUDIT_TARGET_TYPES } from "../../db/schema";
import type { DbOrTx } from "../../db/tx";
import { newUlid } from "../../lib/ids";

export type AuditOperation = (typeof AUDIT_OPERATIONS)[number];
export type AuditTargetType = (typeof AUDIT_TARGET_TYPES)[number];

export interface AuditEntry {
  adminId: string;
  operation: AuditOperation;
  targetType: AuditTargetType;
  targetId?: string | null;
  /** 変更の前の値。undefined は NULL として残す */
  before?: unknown;
  /** 変更の後の値。undefined は NULL として残す */
  after?: unknown;
  worldId?: string | null;
}

const toJson = (value: unknown): string | null => (value === undefined ? null : JSON.stringify(value));

/**
 * admin_audit_logs に1行を足し、audit_id を返す。operated_at は clock.nowIso()。
 * 失敗は例外のまま呼び出し元に返し、呼び出し元のトランザクションごと取り消させる
 */
export function recordAudit(tx: DbOrTx, clock: Clock, entry: AuditEntry): string {
  const auditId = newUlid(clock.nowMs());
  tx.insert(admin_audit_logs)
    .values({
      audit_id: auditId,
      admin_id: entry.adminId,
      operation: entry.operation,
      target_type: entry.targetType,
      target_id: entry.targetId ?? null,
      before_json: toJson(entry.before),
      after_json: toJson(entry.after),
      world_id: entry.worldId ?? null,
      operated_at: clock.nowIso(),
    })
    .run();
  return auditId;
}
