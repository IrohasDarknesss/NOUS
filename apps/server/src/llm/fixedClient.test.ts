import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CancelledError as ClockCancelledError } from "../lib/errors.js";
import { createFixedClient, FixtureError, fixturePath, NONE_RESPONSE_TEXT, type LlmClock } from "./fixedClient.js";
import {
  CancelledError,
  FreeTierExceededError,
  RateLimitedError,
  ServerError,
  TimeoutError,
  type LlmRequest,
} from "./llmClient.js";

/** sleep を実時間で待たず、時刻だけ進める時計 */
class StubClock implements LlmClock {
  ms = Date.UTC(2026, 9, 22);
  sleeps: number[] = [];
  now(): Date {
    return new Date(this.ms);
  }
  async sleep(ms: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted) {
      throw new Error("aborted");
    }
    this.sleeps.push(ms);
    this.ms += ms;
  }
}

function request(handle: string, cycleNo: number, signal: AbortSignal = new AbortController().signal): LlmRequest {
  return {
    modelId: "@cf/google/gemma-4-26b-a4b-it",
    messages: [
      { role: "system", content: "s" },
      { role: "user", content: "u" },
    ],
    maxTokens: 200,
    signal,
    fixtureKey: { handle, cycleNo },
  };
}

const repoFixtureDir = fileURLToPath(new URL("../../../../fixtures/llm", import.meta.url));

describe("fixedClient（fixtures/llm/basic）", () => {
  it("TC-NOUS47_DEV-11 text と usage を LlmResult にして返す", async () => {
    const client = createFixedClient({ fixtureDir: repoFixtureDir, scenario: "basic", clock: new StubClock() });
    const result = await client.generate(request("minato", 1));
    expect(JSON.parse(result.text)).toMatchObject({ action: "post", target: null });
    expect(result).toMatchObject({
      promptTokens: 1420,
      completionTokens: 44,
      neurons: 14.1,
      httpStatus: 200,
      durationMs: 0,
    });
  });

  it("TC-NOUS47_DEV-12 delayMs だけ時計で待ち、durationMs に反映する", async () => {
    const clock = new StubClock();
    const client = createFixedClient({ fixtureDir: repoFixtureDir, scenario: "basic", clock });
    const result = await client.generate(request("riko", 1));
    expect(clock.sleeps).toEqual([1500]);
    expect(result.durationMs).toBe(1500);
    expect(JSON.parse(result.text)).toMatchObject({ action: "like", target: "P1" });
  });

  it("TC-NOUS47_DEV-13 error を書いたファイルはその失敗を起こす", async () => {
    const client = createFixedClient({ fixtureDir: repoFixtureDir, scenario: "basic", clock: new StubClock() });
    const e = await client.generate(request("zen", 1)).catch((err: unknown) => err);
    expect(e).toBeInstanceOf(RateLimitedError);
    expect(e).toMatchObject({ kind: "rate_limited", httpStatus: 429, retryable: true });
  });

  it("TC-NOUS47_DEV-14 ファイルがなければ none の JSON を返す", async () => {
    const client = createFixedClient({ fixtureDir: repoFixtureDir, scenario: "basic", clock: new StubClock() });
    const result = await client.generate(request("gen", 99));
    expect(result.text).toBe(NONE_RESPONSE_TEXT);
    expect(JSON.parse(result.text)).toEqual({ action: "none", target: null, text: null });
    expect(result).toMatchObject({ promptTokens: 0, completionTokens: 0, neurons: 0, httpStatus: 200 });
  });
});

describe("fixedClient（一時ディレクトリの fixtures）", () => {
  let dir: string;
  let clock: StubClock;

  async function put(name: string, body: string): Promise<void> {
    await writeFile(join(dir, "s1", name), body, "utf8");
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "nous47-"));
    await mkdir(join(dir, "s1"));
    clock = new StubClock();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it.each([
    ["timeout", TimeoutError, null],
    ["rate_limited", RateLimitedError, 429],
    ["free_tier", FreeTierExceededError, 429],
    ["server_error", ServerError, 500],
  ] as const)("TC-NOUS47_DEV-21 error=%s を対応する例外で再現する", async (error, type, httpStatus) => {
    await put("aoi-1.json", JSON.stringify({ error }));
    const client = createFixedClient({ fixtureDir: dir, scenario: "s1", clock });
    const e = await client.generate(request("aoi", 1)).catch((err: unknown) => err);
    expect(e).toBeInstanceOf(type);
    expect(e).toMatchObject({ kind: error, httpStatus, detail: "fixture:s1/aoi-1" });
  });

  it("TC-NOUS47_DEV-22 delayMs を待ってから error を起こす", async () => {
    await put("aoi-2.json", JSON.stringify({ error: "server_error", delayMs: 8000 }));
    const client = createFixedClient({ fixtureDir: dir, scenario: "s1", clock });
    await expect(client.generate(request("aoi", 2))).rejects.toBeInstanceOf(ServerError);
    expect(clock.sleeps).toEqual([8000]);
  });

  it("TC-NOUS47_DEV-23 囲み付き・不正な形式の text もそのまま返す（AC-L04）", async () => {
    const text = '```json\n{"action":"post","target":null,"text":"囲み付き"}\n```';
    await put("ken-1.json", JSON.stringify({ text }));
    const client = createFixedClient({ fixtureDir: dir, scenario: "s1", clock });
    const result = await client.generate(request("ken", 1));
    expect(result.text).toBe(text);
    expect(result).toMatchObject({ promptTokens: 0, completionTokens: 0, neurons: 0 });
  });

  it("TC-NOUS47_DEV-24 delayMs の待ちの間に abort されたら CancelledError", async () => {
    await put("sora-1.json", JSON.stringify({ text: "x", delayMs: 8000 }));
    const controller = new AbortController();
    const abortingClock: LlmClock = {
      now: () => new Date(0),
      sleep: async (_ms, signal) => {
        controller.abort();
        throw signal.reason;
      },
    };
    const client = createFixedClient({ fixtureDir: dir, scenario: "s1", clock: abortingClock });
    await expect(client.generate(request("sora", 1, controller.signal))).rejects.toBeInstanceOf(CancelledError);
  });

  it("TC-NOUS47_DEV-25 呼ぶ前に abort 済みなら CancelledError で、ファイルを読まない", async () => {
    const controller = new AbortController();
    controller.abort();
    const client = createFixedClient({ fixtureDir: dir, scenario: "s1", clock });
    await expect(client.generate(request("bad/../x", 1, controller.signal))).rejects.toBeInstanceOf(CancelledError);
  });

  it.each([
    ["JSON でない", "{not json"],
    ["text も error もない", JSON.stringify({ usage: { prompt_tokens: 1, completion_tokens: 1, neurons: 1 } })],
    ["error の値が不正", JSON.stringify({ error: "invalid_format" })],
    ["delayMs が負", JSON.stringify({ text: "x", delayMs: -1 })],
    ["未知の項目", JSON.stringify({ text: "x", unknown: 1 })],
  ])("TC-NOUS47_DEV-26 ファイルの形が不正なら FixtureError（%s）", async (_label, body) => {
    await put("mio-1.json", body);
    const client = createFixedClient({ fixtureDir: dir, scenario: "s1", clock });
    await expect(client.generate(request("mio", 1))).rejects.toBeInstanceOf(FixtureError);
  });
});

describe("fixturePath", () => {
  it("TC-NOUS47_DEV-31 <シナリオ>/<ハンドル>-<巡>.json を組み立てる", () => {
    expect(fixturePath("fixtures/llm", "basic", { handle: "minato", cycleNo: 3 })).toBe(
      join("fixtures/llm", "basic", "minato-3.json"),
    );
  });

  it.each([
    ["basic", { handle: "../etc", cycleNo: 1 }],
    ["basic", { handle: "ab", cycleNo: 1 }],
    ["basic", { handle: "minato", cycleNo: 0 }],
    ["basic", { handle: "minato", cycleNo: 1.5 }],
    ["../basic", { handle: "minato", cycleNo: 1 }],
  ])("TC-NOUS47_DEV-32 パスの外へ出る値・不正な値は FixtureError（%s・%o）", (scenario, key) => {
    expect(() => fixturePath("fixtures/llm", scenario, key)).toThrow(FixtureError);
  });
});

describe("fixedClient と時計の取り消し", () => {
  it("TC-NOUS76_DEV-04 時計が lib の CancelledError で拒否したら、LLM の CancelledError（kind=cancelled）に変換する", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nous76-"));
    try {
      await mkdir(join(dir, "s1"), { recursive: true });
      await writeFile(join(dir, "s1", "sora-1.json"), JSON.stringify({ text: "x", delayMs: 8000 }));
      const cancellingClock: LlmClock = {
        now: () => new Date(0),
        sleep: async () => {
          throw new ClockCancelledError();
        },
      };
      const client = createFixedClient({ fixtureDir: dir, scenario: "s1", clock: cancellingClock });
      const error = await client.generate(request("sora", 1)).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(CancelledError);
      expect((error as CancelledError).kind).toBe("cancelled");
      expect((error as CancelledError).cause).toBeInstanceOf(ClockCancelledError);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
