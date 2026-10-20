import { describe, expect, it } from "vitest";
import { InvalidFormatError } from "../llm/llmClient";
import { truncateText, validateAction, type ValidationContext } from "./actionValidator";
import type { RawAction } from "./outputParser";

const ME = "AGENT_ME";
const context: ValidationContext = {
  agentId: ME,
  refs: [
    { ref: "P1", postId: "POST_1", agentId: "AGENT_HARUKA" },
    { ref: "P2", postId: "POST_2", agentId: ME },
    { ref: "P3", postId: "POST_3", agentId: "AGENT_ZEN" },
  ],
  likeablePostIds: ["POST_1"],
  followTargets: [{ agentId: "AGENT_ZEN", handle: "zen" }],
  followees: [{ agentId: "AGENT_HARUKA", handle: "haruka" }],
};
const ALL = ["post", "reply", "like", "follow", "unfollow"] as const;

describe("validateAction（6.3）", () => {
  it("TC-NOUS62_DEV-11 合格した行動を P 番号・ハンドルから ID にする", () => {
    expect(validateAction({ action: "reply", target: "P1", text: " なるほど " }, context, ALL)).toEqual({
      action: "reply",
      targetRef: "P1",
      targetPostId: "POST_1",
      text: "なるほど",
    });
    expect(validateAction({ action: "like", target: "P1", text: null }, context, ALL)).toEqual({
      action: "like",
      targetRef: "P1",
      targetPostId: "POST_1",
    });
    expect(validateAction({ action: "follow", target: "@zen", text: null }, context, ALL)).toEqual({
      action: "follow",
      targetHandle: "zen",
      targetAgentId: "AGENT_ZEN",
    });
    expect(validateAction({ action: "unfollow", target: "@haruka", text: null }, context, ALL)).toEqual({
      action: "unfollow",
      targetHandle: "haruka",
      targetAgentId: "AGENT_HARUKA",
    });
    expect(validateAction({ action: "post", target: null, text: "こんにちは" }, context, ALL)).toEqual({
      action: "post",
      text: "こんにちは",
    });
  });

  it("TC-NOUS62_DEV-12 none は候補になくてもいつも選べる", () => {
    expect(validateAction({ action: "none", target: null, text: null }, context, ["post", "reply"])).toEqual({
      action: "none",
    });
  });

  it.each<[string, RawAction, readonly (typeof ALL)[number][]]>([
    ["候補にない行動", { action: "like", target: "P1", text: null }, ["post", "reply"]],
    ["存在しない P 番号の返信", { action: "reply", target: "P9", text: "x" }, ALL],
    ["存在しない P 番号のいいね", { action: "like", target: "P9", text: null }, ALL],
    ["自分の投稿へのいいね", { action: "like", target: "P2", text: null }, ALL],
    ["いいね済みの投稿", { action: "like", target: "P3", text: null }, ALL],
    ["フォローできない相手（フォロー中）", { action: "follow", target: "@haruka", text: null }, ALL],
    ["存在しない相手のフォロー", { action: "follow", target: "@nobody_here", text: null }, ALL],
    ["フォロー中でない相手の解除", { action: "unfollow", target: "@zen", text: null }, ALL],
    ["空白だけの本文", { action: "post", target: null, text: "   " }, ALL],
  ])("TC-NOUS62_DEV-13 %s は InvalidFormatError", (_label, raw, candidates) => {
    expect(() => validateAction(raw, context, candidates)).toThrow(InvalidFormatError);
  });

  it("TC-NOUS62_DEV-14 自分を相手にしたフォローは、followTargets に自分が混ざっていても拒否する", () => {
    const withSelf = { ...context, followTargets: [{ agentId: ME, handle: "minato" }] };
    expect(() => validateAction({ action: "follow", target: "@minato", text: null }, withSelf, ALL)).toThrow(
      InvalidFormatError,
    );
  });
});

describe("truncateText", () => {
  it("TC-NOUS62_DEV-15 140 字ちょうどはそのまま", () => {
    const text = "あ".repeat(140);
    expect(truncateText(text)).toBe(text);
  });

  it("TC-NOUS62_DEV-16 141 字以上は 140 字以内の最後の「。！？」で切る", () => {
    const text = `${"あ".repeat(50)}。${"い".repeat(60)}！${"う".repeat(40)}`; // 152 字
    expect(truncateText(text)).toBe(`${"あ".repeat(50)}。${"い".repeat(60)}！`);
  });

  it("TC-NOUS62_DEV-17 切った結果が 20 字未満なら InvalidFormatError", () => {
    expect(() => truncateText(`${"あ".repeat(10)}。${"い".repeat(140)}`)).toThrow(InvalidFormatError);
  });

  it("TC-NOUS62_DEV-18 140 字以内に句点がなければ InvalidFormatError", () => {
    expect(() => truncateText("あ".repeat(141))).toThrow(InvalidFormatError);
  });

  it("TC-NOUS62_DEV-19 字数はコードポイントで数える（絵文字 1 つを 1 字）", () => {
    const text = "😀".repeat(140);
    expect(truncateText(text)).toBe(text);
  });
});
