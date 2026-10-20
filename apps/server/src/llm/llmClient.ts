// LlmClient のインタフェースとエラーの型（BE 詳細設計 generation 2章 LlmClient.generate、6章）。
// Cloudflare の実装（cloudflareClient）と固定応答の実装（fixedClient）を同じ形で呼ぶ（NFR-L-003）。
// エラーの型は共通ライブラリに依存させず、llm/ の中で完結させる。

/** LLM に渡すメッセージ。system 1 件・user 1 件の 2 件で呼ぶ */
export type ChatMessage = {
  role: "system" | "user";
  content: string;
};

/** 固定応答の引き方。Cloudflare の実装は使わない */
export type FixtureKey = {
  handle: string;
  cycleNo: number;
};

export type LlmRequest = {
  modelId: string;
  messages: ChatMessage[];
  /** 出力の上限（world_settings.max_output_tokens、100〜400） */
  maxTokens: number;
  /** 緊急停止で abort される */
  signal: AbortSignal;
  fixtureKey: FixtureKey;
};

export type LlmResult = {
  text: string;
  promptTokens: number;
  completionTokens: number;
  neurons: number;
  httpStatus: number;
  durationMs: number;
};

export interface LlmClient {
  generate(req: LlmRequest): Promise<LlmResult>;
}

/** generation_events.failure_kind・generation_attempts の記録に使う値と同じ名前にする */
export type LlmErrorKind = "timeout" | "rate_limited" | "free_tier" | "server_error" | "invalid_format" | "cancelled";

/** LLM の呼び出しの失敗の基底。種類は kind で見分ける */
export abstract class LlmError extends Error {
  abstract readonly kind: LlmErrorKind;
  /** 30 秒・120 秒の待ちで再試行する一時的な失敗か（6章） */
  abstract readonly retryable: boolean;
  /** HTTP の状態。HTTP を経ない失敗（timeout・cancelled・固定応答）は null */
  readonly httpStatus: number | null;
  /** generation_attempts.error_detail に残す内容（500 字まで）。API トークンは入れない */
  readonly detail: string | null;

  constructor(message: string, options: { httpStatus?: number | null; detail?: string | null; cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.httpStatus = options.httpStatus ?? null;
    this.detail = options.detail == null ? null : options.detail.slice(0, 500);
  }
}

/** 60 秒を超えた */
export class TimeoutError extends LlmError {
  readonly kind = "timeout";
  readonly retryable = true;
}

/** 429（3036 以外。3040 を含む） */
export class RateLimitedError extends LlmError {
  readonly kind = "rate_limited";
  readonly retryable = true;
}

/** 429・3036。再試行せず、スケジューラーが上限停止にする */
export class FreeTierExceededError extends LlmError {
  readonly kind = "free_tier";
  readonly retryable = false;
}

/**
 * 5xx・400・401・success=false。2章の表のとおり 400・401 は再試行しない（入力や権限の問題で、繰り返しても直らない）。
 * それ以外（5xx、success=false、HTTP を経ない固定応答の再現）は再試行する
 */
export class ServerError extends LlmError {
  readonly kind = "server_error";
  get retryable(): boolean {
    return this.httpStatus !== 400 && this.httpStatus !== 401;
  }
}

/** 応答が行動の形になっていない。再試行の対象ではなく、1 回だけ再生成する（6章） */
export class InvalidFormatError extends LlmError {
  readonly kind = "invalid_format";
  readonly retryable = false;
}

/** signal の abort（緊急停止） */
export class CancelledError extends LlmError {
  readonly kind = "cancelled";
  readonly retryable = false;
}

export function isLlmError(e: unknown): e is LlmError {
  return e instanceof LlmError;
}

/** kind から対応する例外を作る。固定応答の失敗の再現などで使う */
export function createLlmError(
  kind: LlmErrorKind,
  message: string,
  options: { httpStatus?: number | null; detail?: string | null; cause?: unknown } = {},
): LlmError {
  switch (kind) {
    case "timeout":
      return new TimeoutError(message, options);
    case "rate_limited":
      return new RateLimitedError(message, options);
    case "free_tier":
      return new FreeTierExceededError(message, options);
    case "server_error":
      return new ServerError(message, options);
    case "invalid_format":
      return new InvalidFormatError(message, options);
    case "cancelled":
      return new CancelledError(message, options);
  }
}
