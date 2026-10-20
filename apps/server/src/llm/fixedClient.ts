// 固定応答の実装（BE 詳細設計 generation 4章 fixedGenerate、行動生成とプロンプトの設計 12章、固定応答のシナリオ）。
// fixtures/llm/<シナリオ>/<ハンドル>-<巡の番号>.json を読み、delayMs だけ時計で待ち、error があればその失敗を起こす。
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { CancelledError, createLlmError, type LlmClient, type LlmRequest, type LlmResult } from "./llmClient.js";

/**
 * 固定応答が使う時計。clock/clock.ts の Clock（now・sleep）をそのまま渡せる形にしておく。
 * test では FakeClock を渡し、delayMs を実時間で待たない
 */
export type LlmClock = {
  now(): Date;
  /** abort されたら拒否する */
  sleep(ms: number, signal: AbortSignal): Promise<void>;
};

export type FixedClientOptions = {
  /** 固定応答の置き場所（AISNS_FIXTURE_DIR、既定 fixtures/llm） */
  fixtureDir: string;
  /** シナリオの名前（basic・follow10・limits・failures・injection・inconsistency・long_run） */
  scenario: string;
  clock: LlmClock;
};

/** fixtures のファイルの形や、引き方の値がおかしい。試験の準備の誤りなので LlmError にはしない */
export class FixtureError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "FixtureError";
  }
}

/** ファイルがないときの応答（何もしない） */
export const NONE_RESPONSE_TEXT = '{"action":"none","target":null,"text":null}';

/** 再現できる失敗（12章）。HTTP の状態は Cloudflare の実装が返すものに合わせる */
const FIXTURE_ERRORS = {
  timeout: null,
  rate_limited: 429,
  free_tier: 429,
  server_error: 500,
} as const;

const usageSchema = z
  .object({
    prompt_tokens: z.number().int().min(0),
    completion_tokens: z.number().int().min(0),
    neurons: z.number().min(0),
  })
  .strict();

export const fixtureSchema = z
  .object({
    /** LLM の応答の本文。囲み付き・不正な形式の応答も入れられる（AC-L04） */
    text: z.string().optional(),
    usage: usageSchema.optional(),
    error: z.enum(["timeout", "rate_limited", "free_tier", "server_error"]).optional(),
    /** この時間だけ待ってから応答する（緊急停止の取り消し、生成中の閲覧の確認） */
    delayMs: z.number().int().min(0).optional(),
  })
  .strict()
  .refine((f) => f.text !== undefined || f.error !== undefined, {
    message: "text か error のどちらかが必要です",
  });

export type Fixture = z.infer<typeof fixtureSchema>;

// ハンドルは agents.handle の制約（英数字と _、3〜20 字）。パスの外へ出ないよう、シナリオの名前も同じ字に限る
const HANDLE_PATTERN = /^[A-Za-z0-9_]{3,20}$/;
const SCENARIO_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;

/** fixtures/llm/<シナリオ>/<ハンドル>-<巡の番号>.json のパスを組み立てる */
export function fixturePath(fixtureDir: string, scenario: string, key: LlmRequest["fixtureKey"]): string {
  if (!SCENARIO_PATTERN.test(scenario)) {
    throw new FixtureError(`シナリオの名前が不正です: ${scenario}`);
  }
  if (!HANDLE_PATTERN.test(key.handle)) {
    throw new FixtureError(`ハンドルが不正です: ${key.handle}`);
  }
  if (!Number.isInteger(key.cycleNo) || key.cycleNo < 1) {
    throw new FixtureError(`巡の番号が不正です: ${key.cycleNo}`);
  }
  return join(fixtureDir, scenario, `${key.handle}-${key.cycleNo}.json`);
}

/** ファイルを読んで検証する。ファイルがなければ null */
export async function loadFixture(path: string): Promise<Fixture | null> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw new FixtureError(`固定応答を読めません: ${path}`, { cause: e });
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    throw new FixtureError(`固定応答が JSON ではありません: ${path}`, { cause: e });
  }
  const parsed = fixtureSchema.safeParse(json);
  if (!parsed.success) {
    throw new FixtureError(`固定応答の形が不正です: ${path}: ${parsed.error.message}`);
  }
  return parsed.data;
}

function cancelled(cause?: unknown): CancelledError {
  return new CancelledError("固定応答の生成が取り消されました", { cause });
}

export class FixedClient implements LlmClient {
  constructor(private readonly options: FixedClientOptions) {}

  async generate(req: LlmRequest): Promise<LlmResult> {
    const { fixtureDir, scenario, clock } = this.options;
    if (req.signal.aborted) {
      throw cancelled(req.signal.reason);
    }
    const startedAt = clock.now().getTime();
    const path = fixturePath(fixtureDir, scenario, req.fixtureKey);
    const fixture = await loadFixture(path);

    if (fixture === null) {
      return {
        text: NONE_RESPONSE_TEXT,
        promptTokens: 0,
        completionTokens: 0,
        neurons: 0,
        httpStatus: 200,
        durationMs: 0,
      };
    }

    if (fixture.delayMs !== undefined && fixture.delayMs > 0) {
      try {
        await clock.sleep(fixture.delayMs, req.signal);
      } catch (e) {
        if (req.signal.aborted) {
          throw cancelled(e);
        }
        throw e;
      }
    }
    if (req.signal.aborted) {
      throw cancelled(req.signal.reason);
    }

    if (fixture.error !== undefined) {
      throw createLlmError(fixture.error, `固定応答による失敗の再現: ${fixture.error}`, {
        httpStatus: FIXTURE_ERRORS[fixture.error],
        detail: `fixture:${scenario}/${req.fixtureKey.handle}-${req.fixtureKey.cycleNo}`,
      });
    }

    return {
      // refine で text か error のどちらかがあることを確かめている
      text: fixture.text ?? NONE_RESPONSE_TEXT,
      promptTokens: fixture.usage?.prompt_tokens ?? 0,
      completionTokens: fixture.usage?.completion_tokens ?? 0,
      neurons: fixture.usage?.neurons ?? 0,
      httpStatus: 200,
      durationMs: clock.now().getTime() - startedAt,
    };
  }
}

export function createFixedClient(options: FixedClientOptions): LlmClient {
  return new FixedClient(options);
}
