// 入力の組み立て（BE 詳細設計：行動生成 4章 buildPrompt・sanitizeTimelineText、
// 行動生成とプロンプトの設計 5章・10章・11章）。prompts/{版}/system.md と user.md に人格・記憶・候補・規則・
// タイムライン・相手の一覧を埋め、見積もりのトークン数が max_input_tokens を超える間は参照する投稿を古い順に外す
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ActionKind } from "../config/generationConfig";
import { ConfigError } from "../lib/errors";
import type { ChatMessage } from "../llm/llmClient";
import {
  numberRefs,
  type AgentContext,
  type AgentRef,
  type MemoryEntry,
  type MemoryKind,
  type RefPost,
} from "./contextLoader";
import { DEFAULT_TOKEN_RATIO, estimateTokens } from "./tokenEstimator";

export type PromptSettings = {
  /** world_settings.prompt_version（prompts/ の下のフォルダの名前） */
  prompt_version: string;
  /** world_settings.max_input_tokens */
  max_input_tokens: number;
  /** world_settings.max_memory_chars */
  max_memory_chars: number;
};

/** generation_events.input_attributes に残す人格の項目 */
export type UsedAttributes = {
  display_name: string;
  handle: string;
  personality: string;
  interests: string;
  topics: string;
  values_text: string;
  stance: string;
  activity_level: number;
};

export type BuiltPrompt = {
  /** system 1 件・user 1 件 */
  messages: ChatMessage[];
  /** 入力に入れた参照する投稿（P1 から番号を付け直したもの）。input_post_ids に記録する */
  refs: RefPost[];
  /** 入力に入れた記憶（切り詰めた後の内容）。input_memories に記録する */
  usedMemories: MemoryEntry[];
  usedAttributes: UsedAttributes;
};

export type BuildPromptOptions = {
  /** テンプレートを置くフォルダ。省略時はリポジトリの直下の prompts/ */
  promptsDir?: string;
};

/** 記憶を切り詰めても入力が上限を超える */
export class PromptTooLargeError extends Error {
  readonly estimatedTokens: number;
  readonly maxInputTokens: number;

  constructor(estimatedTokens: number, maxInputTokens: number) {
    super(`入力が上限を超えます（見積もり ${estimatedTokens} トークン、上限 ${maxInputTokens} トークン）`);
    this.name = "PromptTooLargeError";
    this.estimatedTokens = estimatedTokens;
    this.maxInputTokens = maxInputTokens;
  }
}

/** リポジトリの直下の prompts/（apps/server/src/generation から 4 つ上） */
export const DEFAULT_PROMPTS_DIR = fileURLToPath(new URL("../../../../prompts/", import.meta.url));

/** 版の名前。フォルダの外を指せないように、英数字と . _ - だけを許す */
const PROMPT_VERSION_PATTERN = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,19}$/;

const MEMORY_LABELS: Record<MemoryKind, string> = {
  interest_profile: "関心のプロフィール",
  recent_posts: "最近の自分の行動と投稿",
  relationship_summary: "ほかの住人との関係",
  conversation_summary: "最近の会話",
};

const CANDIDATE_GUIDES: Record<ActionKind | "none", string> = {
  post: "post: 自分の興味や関心分野の話題で、タイムラインにまだ出ていないことを新しく書く（target は null）",
  reply: "reply: タイムラインの投稿に返信する（target は P番号）",
  like: "like: 共感したが、言葉を足すほどではない投稿にいいねをする（target は P番号）",
  follow: "follow: 話してみたい住人や、気になる投稿をした住人をフォローする（target は相手の一覧の @ハンドル）",
  unfollow: "unfollow: 関心が離れたフォロー中の住人のフォローをやめる（target は相手の一覧の @ハンドル）",
  none: "none: 今回は何もしない（target と text は null）",
};

const templateCache = new Map<string, { system: string; user: string }>();

/** prompts/{版}/system.md と user.md を読む（版ごとに1回だけ読む） */
export function loadTemplates(
  version: string,
  promptsDir: string = DEFAULT_PROMPTS_DIR,
): { system: string; user: string } {
  if (!PROMPT_VERSION_PATTERN.test(version) || version.includes("..")) {
    throw new ConfigError(`プロンプトの版の名前が不正です: ${version}`);
  }
  const dir = join(promptsDir, version);
  const cached = templateCache.get(dir);
  if (cached) return cached;
  let templates: { system: string; user: string };
  try {
    templates = {
      system: readFileSync(join(dir, "system.md"), "utf8"),
      user: readFileSync(join(dir, "user.md"), "utf8"),
    };
  } catch (error) {
    throw new ConfigError(`プロンプトのテンプレートを読めません: ${dir}`, { cause: error });
  }
  templateCache.set(dir, templates);
  return templates;
}

/**
 * テンプレートの {{名前}} を値で置き換える。1 回の走査で置き換えるので、値の中の {{…}} は展開しない。
 * 値の無い名前があればテンプレートの誤りとして ConfigError
 */
export function renderTemplate(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{\{([a-z_]+)\}\}/g, (_match, name: string) => {
    const value = values[name];
    if (value === undefined) {
      throw new ConfigError(`プロンプトのテンプレートに未知の項目があります: {{${name}}}`);
    }
    return value;
  });
}

/** タイムラインの本文を整える。閉じタグに見える文字列を全角にし、改行を空白にする（NFR-S-012） */
export function sanitizeTimelineText(body: string): string {
  return body.replace(/<\/timeline>/gi, "＜/timeline＞").replace(/\r\n|\r|\n/g, " ");
}

/** タイムラインの1行：[P番号] 表示名 @ハンドル（@相手 への返信）: 本文 */
export function formatTimelineLine(ref: RefPost): string {
  const replyTo = ref.replyToHandle ? `（@${ref.replyToHandle} への返信）` : "";
  return `[${ref.ref}] ${sanitizeTimelineText(ref.displayName)} @${ref.handle}${replyTo}: ${sanitizeTimelineText(ref.body)}`;
}

/**
 * 記憶を固定の順に並べ、内容の合計を max_memory_chars までにする。超える分は後ろ（conversation_summary の後ろ）から切る
 */
export function fitMemories(entries: readonly MemoryEntry[], maxChars: number): MemoryEntry[] {
  const fitted: MemoryEntry[] = [];
  let remaining = Math.max(0, maxChars);
  for (const entry of entries) {
    if (remaining <= 0) break;
    const chars = [...entry.content];
    const content = chars.length <= remaining ? entry.content : chars.slice(0, remaining).join("");
    remaining -= Math.min(chars.length, remaining);
    if (content.length > 0) fitted.push({ kind: entry.kind, content });
  }
  return fitted;
}

function formatMemories(entries: readonly MemoryEntry[]): string {
  if (entries.length === 0) return "- まだない";
  return entries.map((e) => `- ${MEMORY_LABELS[e.kind]}: ${e.content.replace(/\r\n|\r|\n/g, " ")}`).join("\n");
}

function formatAgents(list: readonly AgentRef[]): string {
  return list.map((a) => `@${a.handle}（${sanitizeTimelineText(a.displayName)}）`).join("、");
}

/** 相手の一覧。候補に follow・unfollow があるときだけ入れる */
function formatTargets(context: AgentContext, candidates: readonly ActionKind[]): string {
  const sections: string[] = [];
  if (candidates.includes("follow") && context.followTargets.length > 0) {
    sections.push(`# フォローできる住人\n${formatAgents(context.followTargets)}`);
  }
  if (candidates.includes("unfollow") && context.followees.length > 0) {
    sections.push(`# フォロー中の住人\n${formatAgents(context.followees)}`);
  }
  return sections.length === 0 ? "" : `\n${sections.join("\n\n")}\n`;
}

function attributesOf(context: AgentContext): UsedAttributes {
  const a = context.agent;
  return {
    display_name: a.display_name,
    handle: a.handle,
    personality: a.personality,
    interests: a.interests,
    topics: a.topics,
    values_text: a.values_text,
    stance: a.stance,
    activity_level: a.activity_level,
  };
}

function render(
  templates: { system: string; user: string },
  context: AgentContext,
  candidates: readonly ActionKind[],
  refs: readonly RefPost[],
  memories: readonly MemoryEntry[],
): ChatMessage[] {
  const attrs = attributesOf(context);
  const system = renderTemplate(templates.system, {
    display_name: attrs.display_name,
    handle: attrs.handle,
    personality: attrs.personality,
    interests: attrs.interests,
    topics: attrs.topics,
    values_text: attrs.values_text,
    stance: attrs.stance,
    activity_level: String(attrs.activity_level),
    memory: formatMemories(memories),
    candidates: candidates.join("・"),
    candidate_guides: [...candidates, "none" as const].map((c) => `- ${CANDIDATE_GUIDES[c]}`).join("\n"),
  });
  const user = renderTemplate(templates.user, {
    timeline: refs.length === 0 ? "（まだ投稿はありません）" : refs.map(formatTimelineLine).join("\n"),
    targets: formatTargets(context, candidates),
  });
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

/**
 * 入力を組み立てる。見積もりが max_input_tokens を超える間、参照する投稿を古い順に1件ずつ外し、
 * それでも超えれば conversation_summary を後ろから切り詰める。記憶を切っても超えれば PromptTooLargeError
 */
export function buildPrompt(
  context: AgentContext,
  candidates: readonly ActionKind[],
  settings: PromptSettings,
  ratio: number = DEFAULT_TOKEN_RATIO,
  options: BuildPromptOptions = {},
): BuiltPrompt {
  const templates = loadTemplates(settings.prompt_version, options.promptsDir);
  const effectiveRatio = Math.max(DEFAULT_TOKEN_RATIO, ratio);
  let refs = numberRefs(context.refs);
  let memories = fitMemories(context.memories, settings.max_memory_chars);

  for (;;) {
    const messages = render(templates, context, candidates, refs, memories);
    const tokens = estimateTokens(messages, ratio);
    if (tokens <= settings.max_input_tokens) {
      return { messages, refs, usedMemories: memories, usedAttributes: attributesOf(context) };
    }
    if (refs.length > 0) {
      // refs は世界内時間の古い順なので、先頭が最も古い
      refs = numberRefs(refs.slice(1));
      continue;
    }
    const summary = memories.find((m) => m.kind === "conversation_summary");
    if (summary && summary.content.length > 0) {
      const chars = [...summary.content];
      const cut = Math.max(1, Math.ceil((tokens - settings.max_input_tokens) / effectiveRatio));
      const content = chars.slice(0, Math.max(0, chars.length - cut)).join("");
      memories = memories.flatMap((m) =>
        m.kind !== "conversation_summary" ? [m] : content.length > 0 ? [{ kind: m.kind, content }] : [],
      );
      continue;
    }
    throw new PromptTooLargeError(tokens, settings.max_input_tokens);
  }
}

/** 組み立てた入力の全文（generation_events.prompt_text に残す形）。system と user を空行で区切る */
export function promptText(messages: readonly ChatMessage[]): string {
  return messages.map((m) => m.content).join("\n\n");
}
