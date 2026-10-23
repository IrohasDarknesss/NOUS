// 単体テスト（NOUS-90）。観点表は docs/test/unit/NOUS-90/観点表_lib.json
import { ERROR_CODES as SHARED_ERROR_CODES } from "@nous/shared";
import { describe, expect, it } from "vitest";
import { AppError, ConfigError, ERROR_CODES, isAppError } from "./errors";

describe("errors（単体テスト）", () => {
  it("TC-UT_LIB-011 AppError は Error の派生で、name と cause を持つ", () => {
    const cause = new Error("SQLITE_CONSTRAINT");

    const err = new AppError("CONFLICT", { cause });

    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("AppError");
    expect(err.cause).toBe(cause);
    expect(err.status).toBe(409);
  });

  it("TC-UT_LIB-012 message だけを渡すと fields は空、fields だけを渡すと message は既定の文言になる", () => {
    const onlyMessage = new AppError("CONFLICT", { message: "招待は 5 名までです" });
    const onlyFields = new AppError("VALIDATION_ERROR", { fields: { limit: "1〜100 にしてください" } });

    expect(onlyMessage.message).toBe("招待は 5 名までです");
    expect(onlyMessage.fields).toEqual({});
    expect(onlyFields.message).toBe("入力の内容を確認してください");
    expect(onlyFields.fields).toEqual({ limit: "1〜100 にしてください" });
  });

  it("TC-UT_LIB-013 isAppError は形だけ似たオブジェクト・null・undefined を AppError としない", () => {
    const lookalike = { name: "AppError", code: "VALIDATION_ERROR", status: 400, message: "x", fields: {} };

    expect(isAppError(lookalike)).toBe(false);
    expect(isAppError(null)).toBe(false);
    expect(isAppError(undefined)).toBe(false);
  });

  it("TC-UT_LIB-014 ConfigError に1件だけの配列を渡すと、まとめの文言で1件を持つ", () => {
    const err = new ConfigError(["AISNS_CLOCK: production では fake にできません"]);

    expect(err.problems).toEqual(["AISNS_CLOCK: production では fake にできません"]);
    expect(err.message).toBe("設定に誤りがあります: AISNS_CLOCK: production では fake にできません");
    expect(err).toBeInstanceOf(Error);
    expect(isAppError(err)).toBe(false);
  });

  it("TC-UT_LIB-015 サーバーのエラーコードと @nous/shared の ERROR_CODES が同じ集合である", () => {
    const server = Object.keys(ERROR_CODES).sort();
    const shared = [...SHARED_ERROR_CODES].sort();

    expect(shared).toEqual(server);
  });
});
