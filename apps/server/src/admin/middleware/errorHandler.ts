// AppError などを JSON のエラーに変える（BE 詳細設計 admin_auth 4章 errorHandler・6章「エラーハンドリング」、
// 基本設計書 概要 4章「エラーの返し方」）。本文は {"error": {"code", "message", "fields"}}
import type { Context, ErrorHandler } from "hono";
import { ZodError } from "zod";
import { AppError, type ErrorFields } from "../../lib/errors";
import type { Logger } from "../../lib/logger";
import type { AdminEnv } from "../context";

/** better-sqlite3 の SqliteError（code が SQLITE_ で始まる）か。Drizzle が包んだときは cause をたどる */
function findSqliteError(err: unknown): { code: string } | undefined {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current instanceof Error; depth += 1) {
    if (current.name === "SqliteError") {
      const code = (current as Error & { code?: unknown }).code;
      return { code: typeof code === "string" ? code : "SQLITE_ERROR" };
    }
    current = current.cause;
  }
  return undefined;
}

export function isUniqueViolation(code: string): boolean {
  return code === "SQLITE_CONSTRAINT_UNIQUE" || code === "SQLITE_CONSTRAINT_PRIMARYKEY";
}

/** ZodError の項目ごとのメッセージ（同じ項目に複数あれば最初のもの） */
export function zodFields(err: ZodError): ErrorFields {
  const fields: ErrorFields = {};
  for (const issue of err.issues) {
    const key = issue.path.length > 0 ? issue.path.join(".") : "_";
    fields[key] ??= issue.message;
  }
  return fields;
}

/** 例外を AppError にそろえ、6章の表の水準でログに出す（秘密は logger が伏せる。SQL の文とスタックは画面に出さない） */
export function toAppError(err: unknown, logger: Logger, path: string): AppError {
  if (err instanceof AppError) {
    logger.info("app_error", { code: err.code, path });
    return err;
  }
  if (err instanceof ZodError) {
    logger.debug("validation_error", { path, fields: zodFields(err) });
    return new AppError("VALIDATION_ERROR", { fields: zodFields(err) });
  }
  const sqlite = findSqliteError(err);
  if (sqlite) {
    // 6章では UNIQUE の違反は 409 CONFLICT だが、CONFLICT は設計書に足すまで使わない（NOUS-44 の再鑑の指示）。
    // それまでは他の SqliteError と同じ 500 にする。UNIQUE の違反は、各サービスが事前に確かめて業務のコードで返す
    logger.error("sqlite_error", { code: sqlite.code, path, uniqueViolation: isUniqueViolation(sqlite.code) });
    return new AppError("INTERNAL_ERROR", { cause: err });
  }
  logger.error("unexpected_error", { path, err });
  return new AppError("INTERNAL_ERROR", { cause: err });
}

export const errorHandler: ErrorHandler<AdminEnv> = (err, c: Context<AdminEnv>) => {
  const appError = toAppError(err, c.var.logger, c.req.path);
  return c.json(appError.toBody(), appError.status);
};
