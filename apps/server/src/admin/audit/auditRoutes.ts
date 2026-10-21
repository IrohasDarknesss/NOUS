// 管理操作履歴のルート（BE 詳細設計 admin_auth 2章 GET /admin/api/audit-logs、3章・4章 listAuditLogs。中身は NOUS-54）
// adminServer が /admin/api に登録する。パスは /admin/api からの相対で書く（例: auditRoutes.get("/audit-logs", …)）。
// 認証は adminServer で済んでいる（requireAdminSession・requireCsrf は 掛かっている）
import { and, desc, eq, lt, or, type SQL } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { AUDIT_OPERATIONS, admin_audit_logs } from "../../db/schema";
import type { DbOrTx } from "../../db/tx";
import { AppError } from "../../lib/errors";
import type { AdminEnv } from "../context";
import type { AuditOperation, AuditTargetType } from "./auditService";

export const DEFAULT_AUDIT_LOGS_LIMIT = 50;
export const MAX_AUDIT_LOGS_LIMIT = 100;

// lib/cursor.ts が統合されたら置き換える
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const INVALID_CURSOR_MESSAGE = "カーソルが正しくありません";

function invalidCursorError(): AppError {
  return new AppError("VALIDATION_ERROR", { fields: { cursor: INVALID_CURSOR_MESSAGE } });
}

function encodeCursor(values: [string, string]): string {
  return Buffer.from(JSON.stringify(values), "utf8").toString("base64url");
}

function decodeCursor(cursor: string): [string, string] {
  if (!BASE64URL_PATTERN.test(cursor)) {
    throw invalidCursorError();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw invalidCursorError();
  }
  if (!Array.isArray(parsed) || parsed.length !== 2 || typeof parsed[0] !== "string" || typeof parsed[1] !== "string") {
    throw invalidCursorError();
  }
  return [parsed[0], parsed[1]];
}

const auditLogsQuerySchema = z.object({
  operation: z.enum(AUDIT_OPERATIONS).optional(),
  cursor: z.string().optional(),
  limit: z
    .string()
    .regex(/^\d+$/, "1〜100 の整数にしてください")
    .transform(Number)
    .refine((n) => Number.isInteger(n) && n >= 1 && n <= MAX_AUDIT_LOGS_LIMIT, "1〜100 の整数にしてください")
    .optional(),
});

const listAuditLogsParamsSchema = z.object({
  operation: z.enum(AUDIT_OPERATIONS).optional(),
  cursor: z.string().optional(),
  limit: z
    .number()
    .int("1〜100 の整数にしてください")
    .min(1, "1〜100 の整数にしてください")
    .max(MAX_AUDIT_LOGS_LIMIT, "1〜100 の整数にしてください")
    .optional(),
});

export interface ListAuditLogsParams {
  operation?: AuditOperation;
  cursor?: string;
  limit?: number;
}

export interface AuditLogItem {
  auditId: string;
  operation: AuditOperation;
  targetType: AuditTargetType;
  targetId: string | null;
  beforeJson: unknown;
  afterJson: unknown;
  operatedAt: string;
}

export interface ListAuditLogsResult {
  items: AuditLogItem[];
  nextCursor: string | null;
}

/**
 * 管理操作履歴を新しい順に返す（3章・4章 listAuditLogs）。
 * (operated_at, audit_id) < カーソルの条件で limit+1 件を読み、limit+1 件目があれば nextCursor を作る。
 */
export function listAuditLogs(db: DbOrTx, params: ListAuditLogsParams = {}): ListAuditLogsResult {
  const parsed = listAuditLogsParamsSchema.parse(params);
  const limit = parsed.limit ?? DEFAULT_AUDIT_LOGS_LIMIT;

  const conditions: SQL[] = [];
  if (parsed.operation !== undefined) {
    conditions.push(eq(admin_audit_logs.operation, parsed.operation));
  }
  if (parsed.cursor !== undefined) {
    const [cursorOperatedAt, cursorAuditId] = decodeCursor(parsed.cursor);
    const cursorCondition = or(
      lt(admin_audit_logs.operated_at, cursorOperatedAt),
      and(eq(admin_audit_logs.operated_at, cursorOperatedAt), lt(admin_audit_logs.audit_id, cursorAuditId)),
    );
    if (cursorCondition) {
      conditions.push(cursorCondition);
    }
  }

  const rows = db
    .select()
    .from(admin_audit_logs)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(admin_audit_logs.operated_at), desc(admin_audit_logs.audit_id))
    .limit(limit + 1)
    .all();

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const lastRow = pageRows[pageRows.length - 1];
  const nextCursor = hasMore && lastRow ? encodeCursor([lastRow.operated_at, lastRow.audit_id]) : null;

  const items: AuditLogItem[] = pageRows.map((row) => ({
    auditId: row.audit_id,
    operation: row.operation,
    targetType: row.target_type,
    targetId: row.target_id,
    beforeJson: row.before_json === null ? null : (JSON.parse(row.before_json) as unknown),
    afterJson: row.after_json === null ? null : (JSON.parse(row.after_json) as unknown),
    operatedAt: row.operated_at,
  }));

  return { items, nextCursor };
}

export const auditRoutes = new Hono<AdminEnv>();

auditRoutes.get("/audit-logs", (c) => {
  const query = auditLogsQuerySchema.parse({
    operation: c.req.query("operation"),
    cursor: c.req.query("cursor"),
    limit: c.req.query("limit"),
  });
  const result = listAuditLogs(c.var.db, query);
  return c.json(result, 200);
});
