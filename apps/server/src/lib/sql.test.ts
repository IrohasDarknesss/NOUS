import { describe, expect, it } from "vitest";
import { LIKE_ESCAPE_CHAR, escapeLike, likeContains } from "./sql.js";

describe("sql", () => {
  it("TC-NOUS44_DEV-13 escapeLike が \\ と % と _ を逃がす", () => {
    expect(escapeLike("100%_a\\b")).toBe("100\\%\\_a\\\\b");
  });

  it("TC-NOUS44_DEV-14 特殊文字のない文字列はそのまま返す", () => {
    expect(escapeLike("こんにちは abc")).toBe("こんにちは abc");
    expect(escapeLike("")).toBe("");
  });

  it("TC-NOUS44_DEV-15 likeContains が部分一致のパターンを作り、ESCAPE の文字が \\ である", () => {
    expect(likeContains("a_b")).toBe("%a\\_b%");
    expect(LIKE_ESCAPE_CHAR).toBe("\\");
  });
});
