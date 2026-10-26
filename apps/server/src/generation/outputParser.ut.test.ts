// 単体テスト（NOUS-103）。観点表は docs/test/unit/NOUS-103/観点表_outputParser.json
import { describe, expect, it } from "vitest";
import { InvalidFormatError } from "../llm/llmClient";
import { parseOutput } from "./outputParser";

/** parseOutput が投げた InvalidFormatError を返す。投げなければ失敗にする */
function catchParse(text: string): InvalidFormatError {
  try {
    parseOutput(text);
  } catch (err) {
    expect(err).toBeInstanceOf(InvalidFormatError);
    return err as InvalidFormatError;
  }
  throw new Error(`parseOutput が例外を投げませんでした: ${text}`);
}

describe("outputParser（単体テスト）", () => {
  it("TC-UT_OUT-001 </think> が 2 つあるときは、最後の </think> の後ろだけを使う", () => {
    const text = '<think>a</think>{"action":"post","target":null,"text":"一つ目"}</think>{"action":"none"}';

    const result = parseOutput(text);

    expect(result).toEqual({ action: "none", target: null, text: null });
  });

  it("TC-UT_OUT-002 </think> の後ろに JSON がなければ、思考の中の JSON は使わず no_json_object", () => {
    const err = catchParse('<think>{"action":"none"}</think>今日はやめておきます');

    expect(err.detail).toBe("no_json_object");
  });

  it("TC-UT_OUT-003 } が { より前にしかないときは no_json_object", () => {
    const err = catchParse("} 投稿しません {");

    expect(err.detail).toBe("no_json_object");
  });

  it("TC-UT_OUT-004 JSON として読めなければ json_parse_error", () => {
    const err = catchParse('{"action":"post",}');

    expect(err.kind).toBe("invalid_format");
    expect(err.detail).toBe("json_parse_error");
  });

  it("TC-UT_OUT-005 スキーマに合わなければ detail が schema: で始まり、項目の名前を含む", () => {
    const err = catchParse('{"action":"share","target":null,"text":null}');

    expect(err.detail).toMatch(/^schema: /);
    expect(err.detail).toContain("action");
  });

  it.each(["P1", "P99"])("TC-UT_OUT-006 P 番号の桁の下限と上限は合格する（%j）", (target) => {
    const result = parseOutput(`{"action":"like","target":"${target}","text":null}`);

    expect(result).toEqual({ action: "like", target, text: null });
  });

  it.each(["@abc", `@${"a".repeat(20)}`])("TC-UT_OUT-007 ハンドルの 3 字と 20 字は合格する（%j）", (target) => {
    const result = parseOutput(`{"action":"follow","target":"${target}","text":null}`);

    expect(result).toEqual({ action: "follow", target, text: null });
  });

  it("TC-UT_OUT-008 ハンドルが 21 字なら InvalidFormatError", () => {
    const err = catchParse(`{"action":"follow","target":"@${"a".repeat(21)}","text":null}`);

    expect(err.detail).toMatch(/^schema: /);
  });

  it("TC-UT_OUT-009 ハンドルに英数字と _ 以外の字があれば InvalidFormatError", () => {
    const err = catchParse('{"action":"unfollow","target":"@ha-ru","text":null}');

    expect(err.detail).toMatch(/^schema: /);
  });

  it("TC-UT_OUT-010 P 番号に数字がなければ InvalidFormatError", () => {
    const err = catchParse('{"action":"reply","target":"P","text":"なるほど"}');

    expect(err.detail).toMatch(/^schema: /);
  });

  it("TC-UT_OUT-011 表にない余分なキーは捨てて取り出す", () => {
    const result = parseOutput('{"action":"like","target":"P2","text":null,"reason":"好きな話題"}');

    expect(result).toEqual({ action: "like", target: "P2", text: null });
  });

  it("TC-UT_OUT-012 action が大文字まじり（Post）なら InvalidFormatError", () => {
    const err = catchParse('{"action":"Post","target":null,"text":"こんにちは"}');

    expect(err.detail).toMatch(/^schema: /);
  });

  it("TC-UT_OUT-013 text が文字列でなく数値なら InvalidFormatError", () => {
    const err = catchParse('{"action":"post","target":null,"text":140}');

    expect(err.detail).toMatch(/^schema: /);
  });

  it("TC-UT_OUT-014 reply の target が null なら InvalidFormatError", () => {
    const err = catchParse('{"action":"reply","target":null,"text":"なるほど"}');

    expect(err.detail).toMatch(/^schema: /);
  });

  it("TC-UT_OUT-015 大文字の言語名（```JSON）と CRLF の囲みも外して取り出す", () => {
    const result = parseOutput('```JSON\r\n{"action":"none","target":null,"text":null}\r\n```');

    expect(result).toEqual({ action: "none", target: null, text: null });
  });

  it("TC-UT_OUT-016 post の text が空文字でも形としては通す（空白の拒否は validateAction）", () => {
    const result = parseOutput('{"action":"post","target":null,"text":""}');

    expect(result).toEqual({ action: "post", target: null, text: "" });
  });
});
