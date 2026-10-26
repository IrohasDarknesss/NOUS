// 単体テスト（NOUS-103）。観点表は docs/test/unit/NOUS-103/観点表_actionValidator.json
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

/** fn が投げた InvalidFormatError を返す。投げなければ失敗にする */
function catchInvalid(fn: () => unknown): InvalidFormatError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(InvalidFormatError);
    return err as InvalidFormatError;
  }
  throw new Error("InvalidFormatError が投げられませんでした");
}

const validate = (raw: RawAction, candidates: readonly (typeof ALL)[number][] = ALL, ctx = context) =>
  validateAction(raw, ctx, candidates);

describe("actionValidator（単体テスト）", () => {
  it("TC-UT_VAL-001 候補にない post は not_candidate:post", () => {
    const err = catchInvalid(() => validate({ action: "post", target: null, text: "こんにちは" }, ["like"]));

    expect(err.kind).toBe("invalid_format");
    expect(err.detail).toBe("not_candidate:post");
  });

  it("TC-UT_VAL-002 候補にない reply は、P 番号が正しくても not_candidate:reply", () => {
    const err = catchInvalid(() => validate({ action: "reply", target: "P1", text: "なるほど" }, ["post", "like"]));

    expect(err.detail).toBe("not_candidate:reply");
  });

  it("TC-UT_VAL-003 参照する投稿にない P 番号は unknown_ref", () => {
    const err = catchInvalid(() => validate({ action: "reply", target: "P9", text: "なるほど" }));

    expect(err.detail).toBe("unknown_ref:P9");
  });

  it("TC-UT_VAL-004 自分の投稿へのいいねは like_own_post", () => {
    const err = catchInvalid(() => validate({ action: "like", target: "P2", text: null }));

    expect(err.detail).toBe("like_own_post:P2");
  });

  it("TC-UT_VAL-005 いいね済みの投稿へのいいねは already_liked", () => {
    const err = catchInvalid(() => validate({ action: "like", target: "P3", text: null }));

    expect(err.detail).toBe("already_liked:P3");
  });

  it("TC-UT_VAL-006 フォローできる住人にない相手のフォローは not_followable", () => {
    const err = catchInvalid(() => validate({ action: "follow", target: "@haruka", text: null }));

    expect(err.detail).toBe("not_followable:@haruka");
  });

  it("TC-UT_VAL-007 フォロー中でない相手の解除は not_following", () => {
    const err = catchInvalid(() => validate({ action: "unfollow", target: "@zen", text: null }));

    expect(err.detail).toBe("not_following:@zen");
  });

  it("TC-UT_VAL-008 自分へのフォローは follow_self", () => {
    const withSelf = { ...context, followTargets: [{ agentId: ME, handle: "minato" }] };

    const err = catchInvalid(() => validate({ action: "follow", target: "@minato", text: null }, ALL, withSelf));

    expect(err.detail).toBe("follow_self:@minato");
  });

  it("TC-UT_VAL-009 参照する投稿が 0 件の文脈での reply は unknown_ref", () => {
    const empty = { ...context, refs: [], likeablePostIds: [] };

    const err = catchInvalid(() => validate({ action: "reply", target: "P1", text: "なるほど" }, ALL, empty));

    expect(err.detail).toBe("unknown_ref:P1");
  });

  it("TC-UT_VAL-021 参照する投稿が 0 件の文脈での like も unknown_ref", () => {
    const empty = { ...context, refs: [], likeablePostIds: [] };

    const err = catchInvalid(() => validate({ action: "like", target: "P1", text: null }, ALL, empty));

    expect(err.detail).toBe("unknown_ref:P1");
  });

  it("TC-UT_VAL-010 reply の本文も 140 字を超えれば、140 字以内の最後の句点で切る", () => {
    const text = `${"あ".repeat(100)}。${"い".repeat(60)}`;

    const result = validate({ action: "reply", target: "P1", text });

    expect(result).toEqual({
      action: "reply",
      targetRef: "P1",
      targetPostId: "POST_1",
      text: `${"あ".repeat(100)}。`,
    });
  });

  it("TC-UT_VAL-011 reply の本文が空白だけなら text_blank", () => {
    const err = catchInvalid(() => validate({ action: "reply", target: "P1", text: " \n " }));

    expect(err.detail).toBe("text_blank");
  });

  it("TC-UT_VAL-012 1 字の本文はそのまま合格する", () => {
    expect(truncateText("あ")).toBe("あ");
  });

  it("TC-UT_VAL-013 全角スペースだけの本文は text_blank", () => {
    const err = catchInvalid(() => truncateText("　　"));

    expect(err.detail).toBe("text_blank");
  });

  it("TC-UT_VAL-014 前後の空白は字数を数える前に除く（中身が 140 字ならそのまま）", () => {
    const body = "あ".repeat(140);

    expect(truncateText(`  ${body}\n`)).toBe(body);
  });

  it("TC-UT_VAL-015 141 字（1 字だけ超え）は句点で切る", () => {
    const text = `${"あ".repeat(100)}。${"い".repeat(40)}`;

    expect([...text]).toHaveLength(141);
    expect(truncateText(text)).toBe(`${"あ".repeat(100)}。`);
  });

  it("TC-UT_VAL-016 140 字目が句点なら 140 字で切る", () => {
    const text = `${"あ".repeat(139)}。${"い".repeat(5)}`;

    expect(truncateText(text)).toBe(`${"あ".repeat(139)}。`);
  });

  it("TC-UT_VAL-017 141 字目の句点は使わず、140 字以内の最後の句点で切る", () => {
    const text = `${"あ".repeat(50)}。${"い".repeat(89)}。う`;

    expect(truncateText(text)).toBe(`${"あ".repeat(50)}。`);
  });

  it("TC-UT_VAL-018 切った結果がちょうど 20 字なら合格する", () => {
    const text = `${"あ".repeat(19)}！${"い".repeat(130)}`;

    expect(truncateText(text)).toBe(`${"あ".repeat(19)}！`);
  });

  it("TC-UT_VAL-019 切った結果が 19 字なら text_too_long", () => {
    const err = catchInvalid(() => truncateText(`${"あ".repeat(18)}？${"い".repeat(130)}`));

    expect(err.detail).toBe("text_too_long");
  });

  it("TC-UT_VAL-020 半角の ! ? では切らない（140 字以内に全角の句点がなければ text_too_long）", () => {
    const err = catchInvalid(() => truncateText(`${"あ".repeat(30)}!${"い".repeat(30)}?${"う".repeat(90)}`));

    expect(err.detail).toBe("text_too_long");
  });
});
