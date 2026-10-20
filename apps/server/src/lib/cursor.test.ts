import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor } from "./cursor";
import { AppError } from "./errors";

describe("cursor", () => {
  it("TC-NOUS56_DEV-01 encodeCursor と decodeCursor で文字列の配列を往復できる", () => {
    const samples: string[][] = [
      ["7200", "01JB0000000000000000000P01"],
      ["2026-10-21T10:00:00.000Z", "01JB0000000000000000000A01"],
      [],
      ["日本語", "a+b/c="],
    ];
    for (const values of samples) {
      const encoded = encodeCursor(values);
      expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(decodeCursor(encoded)).toEqual(values);
    }
  });

  it("TC-NOUS56_DEV-02 decodeCursor は不正な Base64URL・不正な JSON・文字列の配列でない値で 400 VALIDATION_ERROR（fields.cursor）を投げる", () => {
    const notJson = Buffer.from("{broken", "utf8").toString("base64url");
    const notArray = Buffer.from(JSON.stringify({ a: "1" }), "utf8").toString("base64url");
    const nonStringItem = Buffer.from(JSON.stringify(["7200", 123]), "utf8").toString("base64url");
    const invalidInputs = ["", "bad+base64/=", notJson, notArray, nonStringItem];

    for (const input of invalidInputs) {
      expect(() => decodeCursor(input), input).toThrow(AppError);
      try {
        decodeCursor(input);
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        const appErr = err as AppError;
        expect(appErr.code).toBe("VALIDATION_ERROR");
        expect(appErr.status).toBe(400);
        expect(appErr.fields.cursor).toBeTruthy();
      }
    }
  });
});
