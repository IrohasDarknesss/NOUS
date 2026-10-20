// fetch を差し替えて試す。実際の Workers AI は呼ばない（NOUS-51 の完了条件）。
import { describe, expect, it, vi } from "vitest";
import {
  buildRequestBody,
  buildUrl,
  CloudflareClient,
  computeNeurons,
  createCloudflareClient,
  GEMMA4_MODEL_ID,
  QWEN3_MODEL_ID,
  toLlmError,
  type FetchLike,
} from "./cloudflareClient.js";
import { createLlmClient } from "./createLlmClient.js";
import { FixedClient } from "./fixedClient.js";
import {
  CancelledError,
  FreeTierExceededError,
  RateLimitedError,
  ServerError,
  TimeoutError,
  type LlmRequest,
} from "./llmClient.js";

const TOKEN = "cf-secret-token-should-not-leak";
const ACCOUNT = "0123456789abcdef0123456789abcdef";

function request(overrides: Partial<LlmRequest> = {}): LlmRequest {
  return {
    modelId: GEMMA4_MODEL_ID,
    messages: [
      { role: "system", content: "あなたは住人です" },
      { role: "user", content: "JSON で答えてください" },
    ],
    maxTokens: 300,
    signal: new AbortController().signal,
    fixtureKey: { handle: "minato", cycleNo: 1 },
    ...overrides,
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const SUCCESS = {
  success: true,
  result: {
    choices: [{ message: { content: '{"action":"post","target":null,"text":"こんにちは"}' } }],
    usage: { prompt_tokens: 1480, completion_tokens: 72, neurons: 15.4 },
  },
};

function client(fetch: FetchLike, nowMs?: () => number): CloudflareClient {
  return new CloudflareClient({ accountId: ACCOUNT, apiToken: TOKEN, fetch, nowMs });
}

describe("callCloudflare（成功）", () => {
  it("TC-NOUS51_DEV-01 URL・ヘッダー・本文を 2章どおりに送り、本文と usage を返す", async () => {
    const fetch = vi.fn<FetchLike>(async () => json(200, SUCCESS));
    let t = 1000;
    const result = await client(fetch, () => (t += 965)).generate(request());

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/run/@cf/google/gemma-4-26b-a4b-it`);
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(String(init?.body))).toEqual({
      messages: request().messages,
      max_tokens: 300,
      temperature: 0.9,
      chat_template_kwargs: { enable_thinking: false },
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(result).toEqual({
      text: '{"action":"post","target":null,"text":"こんにちは"}',
      promptTokens: 1480,
      completionTokens: 72,
      neurons: 15.4,
      httpStatus: 200,
      durationMs: 965,
    });
  });

  it("TC-NOUS51_DEV-02 Qwen3 は user の末尾に ' /no_think' を付け、chat_template_kwargs を送らない", () => {
    const body = buildRequestBody(request({ modelId: QWEN3_MODEL_ID }));
    expect(body.chat_template_kwargs).toBeUndefined();
    expect(body.messages).toEqual([
      { role: "system", content: "あなたは住人です" },
      { role: "user", content: "JSON で答えてください /no_think" },
    ]);
  });

  it("TC-NOUS51_DEV-03 buildRequestBody は元の messages を書き換えない", () => {
    const req = request({ modelId: QWEN3_MODEL_ID });
    buildRequestBody(req);
    expect(req.messages[1]?.content).toBe("JSON で答えてください");
  });

  it("TC-NOUS51_DEV-04 usage.neurons がなければ単価表から計算する", async () => {
    const body = {
      success: true,
      result: { ...SUCCESS.result, usage: { prompt_tokens: 1000, completion_tokens: 100 } },
    };
    const result = await client(async () => json(200, body)).generate(request());
    expect(result.neurons).toBeCloseTo((1000 * 9091 + 100 * 27273) / 1_000_000, 6);
  });

  it("TC-NOUS51_DEV-05 computeNeurons は Gemma 4・Qwen3 の単価を使い分け、報告値を優先する", () => {
    expect(computeNeurons(GEMMA4_MODEL_ID, 1_000_000, 0)).toBe(9091);
    expect(computeNeurons(GEMMA4_MODEL_ID, 0, 1_000_000)).toBe(27273);
    expect(computeNeurons(QWEN3_MODEL_ID, 1_000_000, 0)).toBe(4625);
    expect(computeNeurons(QWEN3_MODEL_ID, 0, 1_000_000)).toBe(30475);
    expect(computeNeurons(GEMMA4_MODEL_ID, 1000, 100, 12.3)).toBe(12.3);
    // 表にないモデルは高い方の単価
    expect(computeNeurons("@cf/other/model", 1_000_000, 1_000_000)).toBe(9091 + 30475);
  });

  it("TC-NOUS51_DEV-06 buildUrl は model_id の / をそのままパスに入れる", () => {
    expect(buildUrl(ACCOUNT, QWEN3_MODEL_ID)).toBe(
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/run/@cf/qwen/qwen3-30b-a3b-fp8`,
    );
  });
});

describe("toLlmError（2章のステータスコード）", () => {
  it("TC-NOUS51_DEV-11 429・3036 は FreeTierExceededError（再試行しない）", () => {
    const e = toLlmError(429, { success: false, errors: [{ code: 3036, message: "daily free allocation exceeded" }] });
    expect(e).toBeInstanceOf(FreeTierExceededError);
    expect(e).toMatchObject({ kind: "free_tier", httpStatus: 429, retryable: false });
    expect(e.detail).toContain("3036");
  });

  it.each([
    ["3040", { success: false, errors: [{ code: 3040, message: "capacity" }] }],
    ["errors なし", { success: false }],
    ["JSON でない", null],
  ])("TC-NOUS51_DEV-12 3036 以外の 429 は RateLimitedError（%s）", (_label, body) => {
    const e = toLlmError(429, body);
    expect(e).toBeInstanceOf(RateLimitedError);
    expect(e).toMatchObject({ kind: "rate_limited", httpStatus: 429, retryable: true });
  });

  it.each([
    [400, false],
    [401, false],
    [500, true],
    [502, true],
    [503, true],
  ])("TC-NOUS51_DEV-13 HTTP %i は ServerError（再試行 %s）", (status, retryable) => {
    const e = toLlmError(status, { success: false, errors: [{ code: 1000, message: "x" }] });
    expect(e).toBeInstanceOf(ServerError);
    expect(e).toMatchObject({ kind: "server_error", httpStatus: status, retryable });
  });

  it("TC-NOUS51_DEV-14 200 でも success=false なら ServerError", async () => {
    const e = await client(async () => json(200, { success: false, errors: [{ code: 5000, message: "bad" }] }))
      .generate(request())
      .catch((err: unknown) => err);
    expect(e).toBeInstanceOf(ServerError);
    expect(e).toMatchObject({ httpStatus: 200 });
  });

  it("TC-NOUS51_DEV-15 200 で本文が JSON でない、または choices がなければ ServerError", async () => {
    await expect(
      client(async () => new Response("<html>", { status: 200 })).generate(request()),
    ).rejects.toBeInstanceOf(ServerError);
    await expect(
      client(async () => json(200, { success: true, result: { choices: [] } })).generate(request()),
    ).rejects.toBeInstanceOf(ServerError);
  });

  it("TC-NOUS51_DEV-16 HTTP の 429・3036 を generate から FreeTierExceededError で投げる", async () => {
    const fetch: FetchLike = async () => json(429, { success: false, errors: [{ code: 3036, message: "limit" }] });
    await expect(client(fetch).generate(request())).rejects.toBeInstanceOf(FreeTierExceededError);
  });
});

describe("タイムアウト・取り消し・接続の失敗", () => {
  /** signal が abort されるまで返らない fetch */
  const hanging: FetchLike = (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
    });

  it("TC-NOUS51_DEV-21 timeoutMs を超えたら TimeoutError", async () => {
    const c = new CloudflareClient({ accountId: ACCOUNT, apiToken: TOKEN, fetch: hanging, timeoutMs: 20 });
    const e = await c.generate(request()).catch((err: unknown) => err);
    expect(e).toBeInstanceOf(TimeoutError);
    expect(e).toMatchObject({ kind: "timeout", retryable: true, httpStatus: null });
  });

  it("TC-NOUS51_DEV-22 呼び出し中に signal が abort されたら CancelledError", async () => {
    const controller = new AbortController();
    const pending = client(hanging).generate(request({ signal: controller.signal }));
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(CancelledError);
  });

  it("TC-NOUS51_DEV-23 呼ぶ前に abort 済みなら fetch を呼ばずに CancelledError", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetch = vi.fn<FetchLike>(async () => json(200, SUCCESS));
    await expect(client(fetch).generate(request({ signal: controller.signal }))).rejects.toBeInstanceOf(CancelledError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("TC-NOUS51_DEV-24 接続の失敗は ServerError（httpStatus なし、再試行の対象）", async () => {
    const e = await client(async () => {
      throw new TypeError("fetch failed");
    })
      .generate(request())
      .catch((err: unknown) => err);
    expect(e).toBeInstanceOf(ServerError);
    expect(e).toMatchObject({ httpStatus: null, retryable: true });
  });
});

describe("トークンを外に出さない", () => {
  it.each([
    ["429・3036", async () => json(429, { success: false, errors: [{ code: 3036, message: "limit" }] })],
    ["500", async () => json(500, { success: false, errors: [{ code: 1, message: "internal" }] })],
    ["接続の失敗", async () => Promise.reject(new TypeError("fetch failed"))],
  ] as [string, FetchLike][])("TC-NOUS51_DEV-31 失敗（%s）のエラーにトークンが含まれない", async (_label, fetch) => {
    const e = await client(fetch)
      .generate(request())
      .catch((err: unknown) => err);
    const dumped = JSON.stringify(e, Object.getOwnPropertyNames(e as object)) + String(e) + String((e as Error).stack);
    expect(dumped).not.toContain(TOKEN);
  });

  it("TC-NOUS51_DEV-32 クライアントを JSON にしても、列挙してもトークンが出ない", () => {
    const c = createCloudflareClient({ accountId: ACCOUNT, apiToken: TOKEN });
    expect(JSON.stringify(c)).not.toContain(TOKEN);
    expect(Object.values(c as object).join(",")).not.toContain(TOKEN);
  });
});

describe("createLlmClient", () => {
  const clock = { now: () => new Date(0), nowMs: () => 0, sleep: async () => {} };

  it("TC-NOUS51_DEV-41 AISNS_LLM_MODE=cloudflare なら CloudflareClient、fixed なら FixedClient", () => {
    const cf = createLlmClient(
      { llmMode: "cloudflare", cloudflare: { accountId: ACCOUNT, apiToken: TOKEN }, fixtureDir: "fixtures/llm" },
      { clock },
    );
    const fixed = createLlmClient({ llmMode: "fixed", cloudflare: null, fixtureDir: "fixtures/llm" }, { clock });
    expect(cf).toBeInstanceOf(CloudflareClient);
    expect(fixed).toBeInstanceOf(FixedClient);
  });

  it("TC-NOUS51_DEV-42 cloudflare で設定がなければ、トークンを含まないエラー", () => {
    expect(() =>
      createLlmClient({ llmMode: "cloudflare", cloudflare: null, fixtureDir: "fixtures/llm" }, { clock }),
    ).toThrow(/Cloudflare の設定がありません/);
  });

  it("TC-NOUS51_DEV-43 差し替えた fetch が CloudflareClient に渡る", async () => {
    const fetch = vi.fn<FetchLike>(async () => json(200, SUCCESS));
    const c = createLlmClient(
      { llmMode: "cloudflare", cloudflare: { accountId: ACCOUNT, apiToken: TOKEN }, fixtureDir: "fixtures/llm" },
      { clock, fetch },
    );
    await c.generate(request());
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
