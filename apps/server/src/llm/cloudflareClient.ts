// Cloudflare Workers AI の実装（BE 詳細設計 generation 2章 外部連携・LlmClient.generate、4章 callCloudflare・toLlmError・
// computeNeurons、6章、基本設計書 概要 7章 IF-001）。
// API トークンはログ・エラー・戻り値に入れない（6章 セキュリティの補足）。
import {
  CancelledError,
  RateLimitedError,
  FreeTierExceededError,
  ServerError,
  TimeoutError,
  type LlmClient,
  type LlmError,
  type LlmRequest,
  type LlmResult,
} from "./llmClient.js";

export const CLOUDFLARE_API_BASE = "https://api.cloudflare.com/client/v4";
/** 1 回の呼び出しの上限（2章） */
export const DEFAULT_TIMEOUT_MS = 60_000;
/** 試行で決めた値（行動生成とプロンプトの設計 5.3） */
export const TEMPERATURE = 0.9;
/** 無料枠を超えたときの errors[].code */
export const FREE_TIER_ERROR_CODE = 3036;

export const GEMMA4_MODEL_ID = "@cf/google/gemma-4-26b-a4b-it";
export const QWEN3_MODEL_ID = "@cf/qwen/qwen3-30b-a3b-fp8";

/** 料金表の単価（Neurons/100 万トークン、2章） */
const PRICES: Record<string, { input: number; output: number }> = {
  [GEMMA4_MODEL_ID]: { input: 9091, output: 27273 },
  [QWEN3_MODEL_ID]: { input: 4625, output: 30475 },
};
// 表にないモデルは、2 つのうち高い方の単価で見積もる（上限の判定で少なく数えないため）
const FALLBACK_PRICE = { input: 9091, output: 30475 };

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export type CloudflareClientOptions = {
  /** 環境変数 CLOUDFLARE_ACCOUNT_ID */
  accountId: string;
  /** 環境変数 CLOUDFLARE_API_TOKEN。ログ・エラーに出さない */
  apiToken: string;
  /** テストで差し替える。既定は globalThis.fetch */
  fetch?: FetchLike;
  timeoutMs?: number;
  /** 所要時間の計測に使う。Clock の nowMs をそのまま渡せる。既定は Date.now */
  nowMs?: () => number;
};

/** Gemma 4・GLM 系は chat_template_kwargs で思考を止める */
function usesThinkingFlag(modelId: string): boolean {
  return /gemma-4|glm/i.test(modelId);
}

/** Qwen3 は依頼の末尾に ' /no_think' を付けて思考を止める */
function usesNoThinkSuffix(modelId: string): boolean {
  return /qwen3/i.test(modelId);
}

/** リクエストの本文を組み立てる（2章のリクエストパラメータ） */
export function buildRequestBody(req: Pick<LlmRequest, "modelId" | "messages" | "maxTokens">): Record<string, unknown> {
  const messages = req.messages.map((m) => ({ role: m.role, content: m.content }));
  if (usesNoThinkSuffix(req.modelId)) {
    const lastUser = messages.map((m) => m.role).lastIndexOf("user");
    const target = messages[lastUser];
    if (target !== undefined) {
      target.content = `${target.content} /no_think`;
    }
  }
  const body: Record<string, unknown> = {
    messages,
    max_tokens: req.maxTokens,
    temperature: TEMPERATURE,
  };
  if (usesThinkingFlag(req.modelId)) {
    body.chat_template_kwargs = { enable_thinking: false };
  }
  return body;
}

export function buildUrl(accountId: string, modelId: string): string {
  // model_id は '@cf/google/…' のように / を含み、そのままパスに入れる（2章の Path）
  return `${CLOUDFLARE_API_BASE}/accounts/${encodeURIComponent(accountId)}/ai/run/${modelId}`;
}

type CfError = { code?: unknown; message?: unknown };

function errorsOf(body: unknown): CfError[] {
  if (body !== null && typeof body === "object" && Array.isArray((body as { errors?: unknown }).errors)) {
    return (body as { errors: unknown[] }).errors.filter((e): e is CfError => e !== null && typeof e === "object");
  }
  return [];
}

/** error_detail に残す内容。Cloudflare の errors[] の code と message だけを使う（500 字は LlmError が切る） */
function describeErrors(status: number, body: unknown): string {
  const parts = errorsOf(body).map((e) => `${String(e.code ?? "")}:${String(e.message ?? "")}`);
  return parts.length > 0 ? `http ${status} ${parts.join("; ")}` : `http ${status}`;
}

/** 状態と errors[].code を LlmError に変える（4章 toLlmError） */
export function toLlmError(status: number, body: unknown): LlmError {
  const detail = describeErrors(status, body);
  if (status === 429) {
    const isFreeTier = errorsOf(body).some((e) => Number(e.code) === FREE_TIER_ERROR_CODE);
    return isFreeTier
      ? new FreeTierExceededError("Workers AI の無料枠を超えました", { httpStatus: status, detail })
      : new RateLimitedError("Workers AI のレート制限に達しました", { httpStatus: status, detail });
  }
  // 5xx・400・401・success=false。それ以外の 4xx もここに入れる
  return new ServerError("Workers AI の呼び出しに失敗しました", { httpStatus: status, detail });
}

/** usage.neurons があればそれ、なければ料金表の単価から計算する（4章 computeNeurons） */
export function computeNeurons(
  modelId: string,
  promptTokens: number,
  completionTokens: number,
  reported?: number | null,
): number {
  if (typeof reported === "number" && Number.isFinite(reported) && reported >= 0) {
    return reported;
  }
  const price = PRICES[modelId] ?? FALLBACK_PRICE;
  return (promptTokens * price.input + completionTokens * price.output) / 1_000_000;
}

type CfSuccessBody = {
  success?: unknown;
  result?: {
    choices?: { message?: { content?: unknown } }[];
    usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; neurons?: unknown };
  };
};

function toCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

/** fetch の例外を LlmError に変える。signal の abort なら取り消し、それ以外の abort は 60 秒の超過 */
function toFetchError(e: unknown, signal: AbortSignal): LlmError {
  if (signal.aborted) {
    return new CancelledError("Workers AI の呼び出しが取り消されました", { cause: e });
  }
  const name = e instanceof Error ? e.name : "";
  if (name === "TimeoutError" || name === "AbortError") {
    return new TimeoutError("Workers AI の呼び出しが時間内に終わりませんでした", { cause: e });
  }
  // 接続の失敗など。HTTP の状態がないので再試行の対象にする
  const message = e instanceof Error ? e.message : String(e);
  return new ServerError("Workers AI に接続できませんでした", { detail: `fetch ${name}: ${message}`, cause: e });
}

/** 1 回の呼び出し（4章 callCloudflare） */
export async function callCloudflare(options: CloudflareClientOptions, req: LlmRequest): Promise<LlmResult> {
  const doFetch: FetchLike = options.fetch ?? ((url, init) => globalThis.fetch(url, init));
  const nowMs = options.nowMs ?? Date.now;
  if (req.signal.aborted) {
    throw new CancelledError("Workers AI の呼び出しが取り消されました", { cause: req.signal.reason });
  }

  const startedAt = nowMs();
  const signal = AbortSignal.any([AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS), req.signal]);
  let response: Response;
  let raw: string;
  try {
    response = await doFetch(buildUrl(options.accountId, req.modelId), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildRequestBody(req)),
      signal,
    });
    raw = await response.text();
  } catch (e) {
    throw toFetchError(e, req.signal);
  }

  let body: unknown = null;
  try {
    body = JSON.parse(raw);
  } catch {
    body = null;
  }

  if (!response.ok) {
    throw toLlmError(response.status, body);
  }
  const ok = body as CfSuccessBody | null;
  if (ok === null || ok.success !== true) {
    throw toLlmError(response.status, body);
  }
  const content = ok.result?.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new ServerError("Workers AI の応答に本文がありません", {
      httpStatus: response.status,
      detail: `http ${response.status} choices[0].message.content がない`,
    });
  }

  const promptTokens = toCount(ok.result?.usage?.prompt_tokens);
  const completionTokens = toCount(ok.result?.usage?.completion_tokens);
  const reported = ok.result?.usage?.neurons;
  return {
    text: content,
    promptTokens,
    completionTokens,
    neurons: computeNeurons(
      req.modelId,
      promptTokens,
      completionTokens,
      typeof reported === "number" ? reported : null,
    ),
    httpStatus: response.status,
    durationMs: Math.max(0, nowMs() - startedAt),
  };
}

export class CloudflareClient implements LlmClient {
  // # の private にして、ログやエラーの JSON にトークンが写らないようにする
  readonly #options: CloudflareClientOptions;

  constructor(options: CloudflareClientOptions) {
    this.#options = { ...options };
  }

  generate(req: LlmRequest): Promise<LlmResult> {
    return callCloudflare(this.#options, req);
  }
}

export function createCloudflareClient(options: CloudflareClientOptions): LlmClient {
  return new CloudflareClient(options);
}
