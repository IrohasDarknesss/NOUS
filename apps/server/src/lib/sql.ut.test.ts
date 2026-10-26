// 単体テスト（NOUS-90）。観点表は docs/test/unit/NOUS-90/観点表_lib.json
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../test/helpers/testDb";
import { escapeLike, LIKE_ESCAPE_CHAR, likeContains } from "./sql";

describe("sql（単体テスト）", () => {
  it("TC-UT_LIB-029 特殊文字が続いても1字ずつ逃がす", () => {
    expect(escapeLike("%%__\\\\")).toBe("\\%\\%\\_\\_\\\\\\\\");
  });

  it("TC-UT_LIB-030 空の文字列の likeContains は %% になる", () => {
    expect(likeContains("")).toBe("%%");
  });

  describe("SQLite の LIKE と組み合わせる", () => {
    let t: TestDb;

    beforeEach(() => {
      t = createTestDb();
    });

    afterEach(() => t.cleanup());

    const matches = (text: string, query: string): boolean => {
      const row = t.db.$client
        .prepare(`SELECT ? LIKE ? ESCAPE '${LIKE_ESCAPE_CHAR}' AS hit`)
        .get(text, likeContains(query)) as { hit: number };
      return row.hit === 1;
    };

    it.each([
      ["50%", "セール 50% オフ", true],
      ["50%", "セール 500 オフ", false],
      ["a_b", "xa_bx", true],
      ["a_b", "xaxbx", false],
      ["a\\b", "path a\\b", true],
      ["a\\b", "path ab", false],
    ])(
      "TC-UT_LIB-031 likeContains の値を ESCAPE '\\' で使うと特殊文字を字のまま探す（%s が %s に）",
      (query, text, expected) => {
        expect(matches(text, query)).toBe(expected);
      },
    );
  });
});
