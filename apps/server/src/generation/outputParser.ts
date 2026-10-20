// 応答から JSON を取り出し、Zod で検証する（BE 詳細設計 generation 4章 parseOutput、行動生成とプロンプトの設計 6.1・6.2）
import { z } from "zod";
import { InvalidFormatError } from "../llm/llmClient";

/** 参照する投稿の番号（P1〜P99） */
export const POST_REF_PATTERN = /^P\d{1,2}$/;
/** 相手のハンドル（@ 付き） */
export const HANDLE_REF_PATTERN = /^@[A-Za-z0-9_]{3,20}$/;

const postRef = z.string().regex(POST_REF_PATTERN);
const handleRef = z.string().regex(HANDLE_REF_PATTERN);
// 140 字の扱い（切り詰め・拒否）は validateAction の truncateText で行うので、ここでは文字列であることだけ見る
const body = z.string();
// null の項目は、省略されていても null とみなす（LLM が null の項目を落とすことがある）
const nothing = z
  .null()
  .optional()
  .transform(() => null);

/** 6.1 の表の action・target・text の組み合わせ */
export const ActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("post"), target: nothing, text: body }),
  z.object({ action: z.literal("reply"), target: postRef, text: body }),
  z.object({ action: z.literal("like"), target: postRef, text: nothing }),
  z.object({ action: z.literal("follow"), target: handleRef, text: nothing }),
  z.object({ action: z.literal("unfollow"), target: handleRef, text: nothing }),
  z.object({ action: z.literal("none"), target: nothing, text: nothing }),
]);

export type RawAction = z.infer<typeof ActionSchema>;

function invalid(reason: string, cause?: unknown): InvalidFormatError {
  return new InvalidFormatError(`応答が行動の形になっていません: ${reason}`, { detail: reason, cause });
}

/** 先頭の ```json または ``` と、末尾の ``` を除く */
function stripFence(text: string): string {
  return text
    .replace(/^```[A-Za-z]*[ \t]*\r?\n?/, "")
    .replace(/\r?\n?```$/, "")
    .trim();
}

/** 応答の本文から行動を取り出す。取り出せない・形が合わなければ InvalidFormatError */
export function parseOutput(text: string): RawAction {
  // 1. 前後の空白と ``` の囲みを除く
  let s = stripFence(text.trim());
  // 2. '</think>' があれば、その後ろだけにする（後ろに囲みがあることもあるので、もう一度除く）
  const thinkEnd = s.lastIndexOf("</think>");
  if (thinkEnd >= 0) {
    s = stripFence(s.slice(thinkEnd + "</think>".length).trim());
  }
  // 3. 最初の '{' から最後の '}' を JSON.parse
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start < 0 || end < start) {
    throw invalid("no_json_object");
  }
  let value: unknown;
  try {
    value = JSON.parse(s.slice(start, end + 1));
  } catch (e) {
    throw invalid("json_parse_error", e);
  }
  // 4. Zod の ActionSchema で検証する
  const parsed = ActionSchema.safeParse(value);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    throw invalid(`schema: ${issues}`, parsed.error);
  }
  return parsed.data;
}
