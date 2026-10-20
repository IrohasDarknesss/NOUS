// 意味の検証（BE 詳細設計 generation 4章 validateAction・truncateText、行動生成とプロンプトの設計 6.3）。
// 不合格はすべて InvalidFormatError（1 回だけ再生成し、2 回目も不合格なら invalid_format で閉じる）。
import type { ActionKind } from "../config/generationConfig";
import { InvalidFormatError } from "../llm/llmClient";
import type { RawAction } from "./outputParser";

/** 本文の上限（posts.body の CHECK と同じ） */
export const MAX_TEXT_CHARS = 140;
/** 切り詰めた結果がこれより短ければ不正な形式 */
export const MIN_TRUNCATED_CHARS = 20;

/** 参照する投稿の 1 件（P 番号と投稿 ID の対応。contextLoader の selectRefPosts が作る） */
export type RefPostRef = {
  /** P1 から */
  ref: string;
  postId: string;
  /** 投稿したエージェント */
  agentId: string;
};

export type AgentRef = {
  agentId: string;
  handle: string;
};

/**
 * 検証に要る文脈。contextLoader（NOUS-61）の AgentContext から必要な項目だけを受ける。
 * likeablePostIds・followTargets・followees は、contextLoader が DB から読んだ結果（6.3 の条件はそこで満たしている）
 */
export type ValidationContext = {
  agentId: string;
  refs: RefPostRef[];
  /** 参照する投稿のうち、自分の投稿でなく、まだいいねしていないもの */
  likeablePostIds: string[];
  /** フォローできる住人（自分以外で、フォローしていない、同じ世界の稼働中のエージェント） */
  followTargets: AgentRef[];
  /** フォロー中の住人 */
  followees: AgentRef[];
};

export type ValidAction =
  | { action: "post"; text: string }
  | { action: "reply"; targetRef: string; targetPostId: string; text: string }
  | { action: "like"; targetRef: string; targetPostId: string }
  | { action: "follow"; targetHandle: string; targetAgentId: string }
  | { action: "unfollow"; targetHandle: string; targetAgentId: string }
  | { action: "none" };

function invalid(reason: string): InvalidFormatError {
  return new InvalidFormatError(`行動の内容が今回の条件に合いません: ${reason}`, { detail: reason });
}

const chars = (s: string): string[] => [...s];
const SENTENCE_ENDS = new Set(["。", "！", "？"]);

/**
 * 140 字以内ならそのまま。超えれば 140 字以内の最後の「。！？」で切る。切った結果が 20 字未満、
 * または空白だけなら InvalidFormatError（字数は posts.body の CHECK と同じくコードポイントで数える）
 */
export function truncateText(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    throw invalid("text_blank");
  }
  const cs = chars(trimmed);
  if (cs.length <= MAX_TEXT_CHARS) {
    return trimmed;
  }
  const head = cs.slice(0, MAX_TEXT_CHARS);
  let cut = -1;
  for (let i = head.length - 1; i >= 0; i--) {
    if (SENTENCE_ENDS.has(head[i] as string)) {
      cut = i;
      break;
    }
  }
  const result = cut >= 0 ? head.slice(0, cut + 1).join("") : "";
  if (chars(result).length < MIN_TRUNCATED_CHARS) {
    throw invalid("text_too_long");
  }
  return result;
}

function findRef(context: ValidationContext, ref: string): RefPostRef {
  const found = context.refs.find((r) => r.ref === ref);
  if (found === undefined) {
    throw invalid(`unknown_ref:${ref}`);
  }
  return found;
}

function findAgent(list: AgentRef[], handleWithAt: string, reason: string): AgentRef {
  const handle = handleWithAt.replace(/^@/, "");
  const found = list.find((a) => a.handle === handle);
  if (found === undefined) {
    throw invalid(`${reason}:${handleWithAt}`);
  }
  return found;
}

/** 6.3 の意味の検証。合格なら反映に使う形（P 番号・ハンドルを ID にしたもの）を返す */
export function validateAction(
  raw: RawAction,
  context: ValidationContext,
  candidates: readonly ActionKind[],
): ValidAction {
  // 1. action が候補か none
  if (raw.action !== "none" && !candidates.includes(raw.action)) {
    throw invalid(`not_candidate:${raw.action}`);
  }
  switch (raw.action) {
    case "none":
      return { action: "none" };
    case "post":
      return { action: "post", text: truncateText(raw.text) };
    case "reply": {
      // 2. reply の P 番号が refs にある
      const ref = findRef(context, raw.target);
      return { action: "reply", targetRef: ref.ref, targetPostId: ref.postId, text: truncateText(raw.text) };
    }
    case "like": {
      // 2・3. like の P 番号が refs にあり、対象が自分のでなく未いいね
      const ref = findRef(context, raw.target);
      if (ref.agentId === context.agentId) {
        throw invalid(`like_own_post:${raw.target}`);
      }
      if (!context.likeablePostIds.includes(ref.postId)) {
        throw invalid(`already_liked:${raw.target}`);
      }
      return { action: "like", targetRef: ref.ref, targetPostId: ref.postId };
    }
    case "follow": {
      // 4. follow の相手が稼働中・未フォロー・自分でない（FR-210）
      const target = findAgent(context.followTargets, raw.target, "not_followable");
      if (target.agentId === context.agentId) {
        throw invalid(`follow_self:${raw.target}`);
      }
      return { action: "follow", targetHandle: target.handle, targetAgentId: target.agentId };
    }
    case "unfollow": {
      // 5. unfollow の相手がフォロー中
      const target = findAgent(context.followees, raw.target, "not_following");
      return { action: "unfollow", targetHandle: target.handle, targetAgentId: target.agentId };
    }
  }
}
