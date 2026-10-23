// 単体テスト（NOUS-89 の見本）。観点表は docs/test/unit/NOUS-89/観点表_cursor.json
import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor } from "./cursor";
import { AppError, ERROR_CODES } from "./errors";

const b64url = (json: string): string => Buffer.from(json, "utf8").toString("base64url");

/** decodeCursor が投げた AppError を返す。投げなければ失敗にする */
function catchDecode(cursor: string): AppError {
  try {
    decodeCursor(cursor);
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    return err as AppError;
  }
  throw new Error(`decodeCursor が例外を投げませんでした: ${cursor}`);
}

function expectValidationError(cursor: string): void {
  const err = catchDecode(cursor);
  expect(err.code).toBe("VALIDATION_ERROR");
  expect(err.status).toBe(400);
}

describe("cursor（単体テスト）", () => {
  it("TC-UT_LIB-001 encodeCursor は JSON をパディングなしの Base64URL にする", () => {
    expect(encodeCursor(["a"])).toBe("WyJhIl0");
  });

  it("TC-UT_LIB-002 空文字だけの配列も往復できる", () => {
    const encoded = encodeCursor([""]);

    expect(encoded).toBe("WyIiXQ");
    expect(decodeCursor(encoded)).toEqual([""]);
  });

  it("TC-UT_LIB-003 エスケープが要る字と絵文字を含んでも往復できる", () => {
    const values = ['say "hi"', "a\\b", "1行目\n2行目", "\u{1F600}", " "];

    expect(decodeCursor(encodeCursor(values))).toEqual(values);
  });

  it("TC-UT_LIB-004 cursor が undefined でも 400 VALIDATION_ERROR になる", () => {
    expectValidationError(undefined as unknown as string);
  });

  it("TC-UT_LIB-005 パディング付きのカーソルは 400 VALIDATION_ERROR になる", () => {
    expectValidationError("WyJhIl0=");
  });

  it.each(["WyJh Il0", "WyJhIl0\n"])(
    "TC-UT_LIB-006 空白・改行を含むカーソルは 400 VALIDATION_ERROR になる（%j）",
    (cursor) => {
      expectValidationError(cursor);
    },
  );

  it("TC-UT_LIB-007 復号すると空になる 1 字のカーソルは 400 VALIDATION_ERROR になる", () => {
    expectValidationError("a");
  });

  it("TC-UT_LIB-008 JSON の null は 400 VALIDATION_ERROR になる", () => {
    expect(b64url("null")).toBe("bnVsbA");
    expectValidationError("bnVsbA");
  });

  it.each(['[["a"]]', '["a",null]'])(
    "TC-UT_LIB-009 文字列でない要素を含む配列は 400 VALIDATION_ERROR になる（%s）",
    (json) => {
      expectValidationError(b64url(json));
    },
  );

  it.each([
    ["B1", ""],
    ["B2", "WyJhIl0="],
    ["B3", "a"],
    ["B4", "bnVsbA"],
    ["B5", b64url("[1]")],
  ])("TC-UT_LIB-010 どの分岐で落ちても fields.cursor は同じ文言になる（%s）", (_branch, cursor) => {
    const err = catchDecode(cursor);

    expect(err.fields).toEqual({ cursor: "カーソルが正しくありません" });
    expect(err.message).toBe(ERROR_CODES.VALIDATION_ERROR.message);
  });
});
