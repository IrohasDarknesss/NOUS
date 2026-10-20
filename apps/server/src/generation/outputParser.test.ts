import { describe, expect, it } from "vitest";
import { InvalidFormatError } from "../llm/llmClient";
import { parseOutput } from "./outputParser";

describe("parseOutput（6.1・6.2）", () => {
  it("TC-NOUS62_DEV-01 素の JSON を取り出す", () => {
    expect(parseOutput('{"action":"post","target":null,"text":"こんにちは"}')).toEqual({
      action: "post",
      target: null,
      text: "こんにちは",
    });
  });

  it.each([
    ["```json の囲み", '```json\n{"action":"reply","target":"P3","text":"なるほど"}\n```'],
    ["``` の囲み", '```\n{"action":"reply","target":"P3","text":"なるほど"}\n```'],
    ["前後の空白と文", '  はい、答えます。\n{"action":"reply","target":"P3","text":"なるほど"} 以上です。 '],
    [
      "</think> の後ろ",
      '<think>{"action":"none"}を考える</think>\n```json\n{"action":"reply","target":"P3","text":"なるほど"}\n```',
    ],
  ])("TC-NOUS62_DEV-02 %s も取り出す", (_label, text) => {
    expect(parseOutput(text)).toEqual({ action: "reply", target: "P3", text: "なるほど" });
  });

  it("TC-NOUS62_DEV-03 null の項目が省略されていても null とみなす", () => {
    expect(parseOutput('{"action":"none"}')).toEqual({ action: "none", target: null, text: null });
    expect(parseOutput('{"action":"like","target":"P1"}')).toEqual({ action: "like", target: "P1", text: null });
    expect(parseOutput('{"action":"follow","target":"@haruka","text":null}')).toEqual({
      action: "follow",
      target: "@haruka",
      text: null,
    });
  });

  it.each([
    ["JSON がない", "今日は投稿しません。"],
    ["JSON が壊れている", '{"action":"post","text":"x"'],
    ["未知の action", '{"action":"share","target":null,"text":"x"}'],
    ["post に target", '{"action":"post","target":"P1","text":"x"}'],
    ["post に text がない", '{"action":"post","target":null}'],
    ["reply の target が P 番号でない", '{"action":"reply","target":"3","text":"x"}'],
    ["reply の P 番号が 3 桁", '{"action":"reply","target":"P100","text":"x"}'],
    ["like に text", '{"action":"like","target":"P1","text":"いいね"}'],
    ["follow の target に @ がない", '{"action":"follow","target":"haruka","text":null}'],
    ["unfollow のハンドルが短い", '{"action":"unfollow","target":"@ab","text":null}'],
    ["none に text", '{"action":"none","target":null,"text":"x"}'],
    ["配列", '[{"action":"none"}]'],
  ])("TC-NOUS62_DEV-04 %s は InvalidFormatError", (_label, text) => {
    expect(() => parseOutput(text)).toThrow(InvalidFormatError);
  });

  it("TC-NOUS62_DEV-05 InvalidFormatError の kind は invalid_format で、理由を detail に残す", () => {
    try {
      parseOutput("JSON なし");
      expect.unreachable();
    } catch (e) {
      expect(e).toMatchObject({ kind: "invalid_format", retryable: false, detail: "no_json_object" });
    }
  });
});
