// 単体テスト（NOUS-91）。観点表は docs/test/unit/NOUS-91/観点表_admin_common.json
import { describe, expect, it } from "vitest";
import { z, ZodError } from "zod";
import { captureLogger } from "../../../test/helpers/adminTestSupport";
import { AppError } from "../../lib/errors";
import { isUniqueViolation, toAppError, zodFields } from "./errorHandler";

/** better-sqlite3 の SqliteError と同じ name・code を持つ例外 */
function sqliteError(code: unknown): Error {
  return Object.assign(new Error("UNIQUE constraint failed: worlds.world_id"), { name: "SqliteError", code });
}

/** depth 回 cause で包む */
function wrap(err: Error, depth: number): Error {
  let current = err;
  for (let i = 0; i < depth; i += 1) {
    current = new Error(`wrap ${i}`, { cause: current });
  }
  return current;
}

describe("errorHandler（単体テスト）", () => {
  it("TC-UT_ADM-013 Drizzle などが cause に包んだ SqliteError も UNIQUE の違反として 409 CONFLICT にする", () => {
    const { logger } = captureLogger();

    const appError = toAppError(wrap(sqliteError("SQLITE_CONSTRAINT_UNIQUE"), 1), logger, "/x");

    expect(appError.code).toBe("CONFLICT");
  });

  it.each([
    [4, "CONFLICT"],
    [5, "INTERNAL_ERROR"],
  ])("TC-UT_ADM-014 cause をたどるのは 5 段まで（%i 回包んだとき）", (depth, expected) => {
    const { logger } = captureLogger();

    const appError = toAppError(wrap(sqliteError("SQLITE_CONSTRAINT_UNIQUE"), depth), logger, "/x");

    expect(appError.code).toBe(expected);
  });

  it.each([
    ["SQLITE_CONSTRAINT_PRIMARYKEY", "CONFLICT"],
    ["SQLITE_CONSTRAINT_FOREIGNKEY", "INTERNAL_ERROR"],
    [123, "INTERNAL_ERROR"],
  ])("TC-UT_ADM-015 主キーの違反は 409、外部キーの違反と文字列でない code は 500 にする（%s）", (code, expected) => {
    const captured = captureLogger();

    const appError = toAppError(sqliteError(code), captured.logger, "/x");

    expect(appError.code).toBe(expected);
    expect(captured.lines()[0]).toMatchObject({
      msg: "sqlite_error",
      code: typeof code === "string" ? code : "SQLITE_ERROR",
    });
    expect(isUniqueViolation(typeof code === "string" ? code : "SQLITE_ERROR")).toBe(expected === "CONFLICT");
  });

  it("TC-UT_ADM-016 zodFields は項目のない問題を _ に、同じ項目の2つ目以降は捨てて最初の文言にする", () => {
    const schema = z.object({ label: z.string().min(3, "3 字以上").regex(/^a/, "a で始める") });
    const result = schema.safeParse({ label: "x" });

    expect(result.success).toBe(false);
    expect(zodFields((result as { error: ZodError }).error)).toEqual({ label: "3 字以上" });
    const root = z
      .object({})
      .refine(() => false, "全体の誤り")
      .safeParse({});
    expect(zodFields((root as { error: ZodError }).error)).toEqual({ _: "全体の誤り" });
  });

  it("TC-UT_ADM-017 toAppError は Error でない値（文字列）も 500 INTERNAL_ERROR の固定の文言にする", () => {
    const captured = captureLogger();

    const appError = toAppError("raw", captured.logger, "/x");

    expect(appError.code).toBe("INTERNAL_ERROR");
    expect(appError.toBody()).toEqual({
      error: { code: "INTERNAL_ERROR", message: "処理に失敗しました。時間をおいて再度お試しください", fields: {} },
    });
    expect(captured.lines()[0]).toMatchObject({ level: "error", msg: "unexpected_error", path: "/x", err: "raw" });
  });

  it("TC-UT_ADM-018 AppError は info、入力の誤りは debug、想定外の例外は error の水準でログに出す", () => {
    const captured = captureLogger();

    toAppError(new AppError("POST_NOT_FOUND"), captured.logger, "/a");
    toAppError(new ZodError([]), captured.logger, "/b");
    toAppError(new Error("boom"), captured.logger, "/c");

    expect(captured.lines().map((l) => [l.level, l.msg, l.path])).toEqual([
      ["info", "app_error", "/a"],
      ["debug", "validation_error", "/b"],
      ["error", "unexpected_error", "/c"],
    ]);
  });
});
