// 単体テスト（NOUS-96）。観点表は docs/test/unit/NOUS-96/観点表_cloudflareClient.json
// fetch を差し替えて試す。実際の Workers AI は呼ばない。
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildRequestBody,
  buildUrl,
  CloudflareClient,
  computeNeurons,
  GEMMA4_MODEL_ID,
  QWEN3_MODEL_ID,
  toLlmError,
  type FetchLike,
} from "./cloudflareClient.js";
import { FreeTierExceededError, ServerError, TimeoutError, type ChatMessage, type LlmRequest } from "./llmClient.js";

const TOKEN = "cf-secret-token-nous96-should-not-leak";
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

function success(result: Record<string, unknown>): Response {
  return json(200, { success: true, result });
}

const CONTENT = '{"action":"post","target":null,"text":"こんにちは"}';
const CHOICES = [{ message: { content: CONTENT } }];

function client(fetch: FetchLike, nowMs?: () => number): CloudflareClient {
  return new CloudflareClient({ accountId: ACCOUNT, apiToken: TOKEN, fetch, nowMs });
}

/** 失敗を値として受け取る。成功したら失敗にする */
async function rejectionOf(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (err) {
    return err;
  }
  throw new Error("拒否されませんでした");
}

describe("cloudflareClient（単体テスト）", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("TC-UT_LLM-028 GLM 系のモデルは chat_template_kwargs で思考を止め、' /no_think' は付けない", () => {
    const req = request({ modelId: "@cf/zai-org/glm-4.7-flash" });

    const body = buildRequestBody(req);

    expect(body.chat_template_kwargs).toEqual({ enable_thinking: false });
    expect(body.messages).toEqual(req.messages);
  });

  it("TC-UT_LLM-029 Gemma 4・GLM・Qwen3 以外のモデルは、どちらの思考の止め方もしない", () => {
    const req = request({ modelId: "@cf/meta/llama-3.1-8b-instruct" });

    const body = buildRequestBody(req);

    expect(body).toEqual({ messages: req.messages, max_tokens: 300, temperature: 0.9 });
  });

  it("TC-UT_LLM-030 Qwen3 で user のメッセージがなければ、何も付けずに送る", () => {
    const messages: ChatMessage[] = [{ role: "system", content: "あなたは住人です" }];

    const body = buildRequestBody({ modelId: QWEN3_MODEL_ID, messages, maxTokens: 100 });

    expect(body.messages).toEqual(messages);
    expect(body.chat_template_kwargs).toBeUndefined();
  });

  it("TC-UT_LLM-031 Qwen3 で user が 2 件あれば、最後の user だけに ' /no_think' を付ける", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "1 件目" },
      { role: "system", content: "s" },
      { role: "user", content: "2 件目" },
    ];

    const body = buildRequestBody({ modelId: QWEN3_MODEL_ID, messages, maxTokens: 100 });

    expect(body.messages).toEqual([
      { role: "user", content: "1 件目" },
      { role: "system", content: "s" },
      { role: "user", content: "2 件目 /no_think" },
    ]);
  });

  it("TC-UT_LLM-032 アカウント ID はパスの区切りにならないよう符号化する", () => {
    const url = buildUrl("a/b?c", GEMMA4_MODEL_ID);

    expect(url).toBe("https://api.cloudflare.com/client/v4/accounts/a%2Fb%3Fc/ai/run/@cf/google/gemma-4-26b-a4b-it");
  });

  it('TC-UT_LLM-033 errors[].code が文字列の "3036" でも、429 なら無料枠の超過とみなす', () => {
    const e = toLlmError(429, { success: false, errors: [{ code: "3036", message: "limit" }] });

    expect(e).toBeInstanceOf(FreeTierExceededError);
  });

  it("TC-UT_LLM-034 errors にオブジェクトでない要素が混ざっていても、オブジェクトの要素だけで判定し、detail に載せる", () => {
    const body = { success: false, errors: [null, "x", 7, { code: 3036, message: "limit" }] };

    const e = toLlmError(429, body);

    expect(e).toBeInstanceOf(FreeTierExceededError);
    expect(e.detail).toBe("http 429 3036:limit");
  });

  it("TC-UT_LLM-035 detail は「http <状態> <code>:<message>」を「; 」でつなぎ、errors がなければ「http <状態>」だけ", () => {
    const body = {
      success: false,
      errors: [
        { code: 1000, message: "a" },
        { code: 1001, message: "b" },
      ],
    };

    const withErrors = toLlmError(500, body);
    const withoutBody = toLlmError(500, null);

    expect(withErrors.detail).toBe("http 500 1000:a; 1001:b");
    expect(withoutBody.detail).toBe("http 500");
  });

  it("TC-UT_LLM-036 429 以外で 3036 が返っても、無料枠の超過にはしない", () => {
    const e = toLlmError(500, { success: false, errors: [{ code: 3036, message: "limit" }] });

    expect(e).toBeInstanceOf(ServerError);
    expect(e.kind).toBe("server_error");
  });

  it.each([403, 404, 413])(
    "TC-UT_LLM-037 400・401・429 以外の 4xx（403・404・413）は ServerError で、再試行しない（%j）",
    (status) => {
      const e = toLlmError(status, { success: false, errors: [{ code: 1000, message: "x" }] });

      expect(e).toBeInstanceOf(ServerError);
      expect(e.retryable).toBe(false);
    },
  );

  it("TC-UT_LLM-038 報告された neurons が 0 なら 0 を使い、単価表で計算しない", () => {
    const neurons = computeNeurons(GEMMA4_MODEL_ID, 1000, 100, 0);

    expect(neurons).toBe(0);
  });

  it.each([-0.001, Number.NaN, Number.POSITIVE_INFINITY])(
    "TC-UT_LLM-039 報告された neurons が負・NaN・Infinity なら、単価表から計算する（%j）",
    (reported) => {
      const neurons = computeNeurons(GEMMA4_MODEL_ID, 1_000_000, 0, reported);

      expect(neurons).toBe(9091);
    },
  );

  it("TC-UT_LLM-040 2xx でない応答の本文が JSON でなくても ServerError にし、detail は「http <状態>」", async () => {
    const fetch: FetchLike = async () => new Response("<html>Bad Gateway</html>", { status: 502 });

    const err = await rejectionOf(client(fetch).generate(request()));

    expect(err).toBeInstanceOf(ServerError);
    expect(err).toMatchObject({ httpStatus: 502, detail: "http 502", retryable: true });
  });

  it("TC-UT_LLM-041 usage がなければトークンを 0 とし、neurons も 0 になる", async () => {
    const fetch: FetchLike = async () => success({ choices: CHOICES });

    const result = await client(fetch).generate(request());

    expect(result).toMatchObject({ promptTokens: 0, completionTokens: 0, neurons: 0 });
  });

  it("TC-UT_LLM-042 usage のトークンが負・文字列なら 0 として扱う", async () => {
    const fetch: FetchLike = async () =>
      success({ choices: CHOICES, usage: { prompt_tokens: -5, completion_tokens: "72", neurons: 1 } });

    const result = await client(fetch).generate(request());

    expect(result.promptTokens).toBe(0);
    expect(result.completionTokens).toBe(0);
  });

  it("TC-UT_LLM-043 usage.neurons が文字列なら報告値として使わず、単価表から計算する", async () => {
    const fetch: FetchLike = async () =>
      success({ choices: CHOICES, usage: { prompt_tokens: 1_000_000, completion_tokens: 0, neurons: "15.4" } });

    const result = await client(fetch).generate(request());

    expect(result.neurons).toBe(9091);
  });

  it.each([123, null])(
    "TC-UT_LLM-044 choices[0].message.content が文字列でなければ ServerError（%j）",
    async (content) => {
      const fetch: FetchLike = async () => success({ choices: [{ message: { content } }] });

      const err = await rejectionOf(client(fetch).generate(request()));

      expect(err).toBeInstanceOf(ServerError);
      expect(err).toMatchObject({ httpStatus: 200 });
    },
  );

  it("TC-UT_LLM-045 時計が戻っても durationMs は負にならず 0 になる", async () => {
    const times = [5000, 4000];
    const fetch: FetchLike = async () => success({ choices: CHOICES });

    const result = await client(fetch, () => times.shift() ?? 4000).generate(request());

    expect(result.durationMs).toBe(0);
  });

  it("TC-UT_LLM-046 fetch を渡さなければ globalThis.fetch を、nowMs を渡さなければ Date.now を使う", async () => {
    const globalFetch = vi.fn(async () => success({ choices: CHOICES }));
    vi.stubGlobal("fetch", globalFetch);
    vi.spyOn(Date, "now").mockReturnValueOnce(10_000).mockReturnValueOnce(10_750);
    const c = new CloudflareClient({ accountId: ACCOUNT, apiToken: TOKEN });

    const result = await c.generate(request());

    expect(globalFetch).toHaveBeenCalledTimes(1);
    expect(result.durationMs).toBe(750);
  });

  it("TC-UT_LLM-047 timeoutMs を渡さなければ 60 秒で打ち切る", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const fetch: FetchLike = async () => success({ choices: CHOICES });

    await client(fetch).generate(request());

    expect(timeout).toHaveBeenCalledWith(60_000);
  });

  it("TC-UT_LLM-048 本文の読み取り（response.text）が失敗したら ServerError（httpStatus なし）", async () => {
    const broken = new Response("{}", { status: 200 });
    vi.spyOn(broken, "text").mockRejectedValue(new TypeError("terminated"));
    const fetch: FetchLike = async () => broken;

    const err = await rejectionOf(client(fetch).generate(request()));

    expect(err).toBeInstanceOf(ServerError);
    expect(err).toMatchObject({ httpStatus: null, retryable: true });
  });

  it("TC-UT_LLM-049 依頼の signal が abort されていないのに AbortError で失敗したら TimeoutError", async () => {
    const fetch: FetchLike = async () => {
      throw new DOMException("aborted", "AbortError");
    };

    const err = await rejectionOf(client(fetch).generate(request()));

    expect(err).toBeInstanceOf(TimeoutError);
  });

  it("TC-UT_LLM-050 fetch が Error 以外を投げたら ServerError にし、detail に値を文字列で残す", async () => {
    const fetch: FetchLike = async () => {
      throw "boom";
    };

    const err = await rejectionOf(client(fetch).generate(request()));

    expect(err).toBeInstanceOf(ServerError);
    expect(err).toMatchObject({ detail: "fetch : boom", cause: "boom" });
  });

  it("TC-UT_LLM-051 401（認証の失敗）は再試行しない ServerError で、エラーにトークンが含まれない", async () => {
    const fetch: FetchLike = async () =>
      json(401, { success: false, errors: [{ code: 10000, message: "Authentication error" }] });

    const err = await rejectionOf(client(fetch).generate(request()));
    const dumped =
      JSON.stringify(err, Object.getOwnPropertyNames(err as object)) + String(err) + String((err as Error).stack);

    expect(err).toBeInstanceOf(ServerError);
    expect(err).toMatchObject({ retryable: false, detail: "http 401 10000:Authentication error" });
    expect(dumped).not.toContain(TOKEN);
  });
});
