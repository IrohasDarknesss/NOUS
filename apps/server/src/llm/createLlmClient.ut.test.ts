// 単体テスト（NOUS-96）。観点表は docs/test/unit/NOUS-96/観点表_cloudflareClient.json
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeClock } from "../clock/fakeClock.js";
import type { FetchLike } from "./cloudflareClient.js";
import { createLlmClient } from "./createLlmClient.js";
import { FixedClient } from "./fixedClient.js";
import type { LlmRequest } from "./llmClient.js";

const START = new Date("2026-10-22T09:00:00.000Z");
const CLOUDFLARE = { accountId: "0123456789abcdef0123456789abcdef", apiToken: "cf-secret-token-nous96" };

function request(handle: string, cycleNo: number): LlmRequest {
  return {
    modelId: "@cf/google/gemma-4-26b-a4b-it",
    messages: [
      { role: "system", content: "s" },
      { role: "user", content: "u" },
    ],
    maxTokens: 200,
    signal: new AbortController().signal,
    fixtureKey: { handle, cycleNo },
  };
}

describe("createLlmClient（単体テスト）", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "nous96-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("TC-UT_LLM-052 固定応答のシナリオの名前を指定すると、そのシナリオのファイルを読む", async () => {
    await mkdir(join(dir, "s2"));
    await writeFile(join(dir, "s2", "aoi-1.json"), JSON.stringify({ text: "s2 の応答" }), "utf8");
    const c = createLlmClient(
      { llmMode: "fixed", cloudflare: null, fixtureDir: dir },
      { clock: new FakeClock(START), fixtureScenario: "s2" },
    );

    const result = await c.generate(request("aoi", 1));

    expect(result.text).toBe("s2 の応答");
  });

  it("TC-UT_LLM-053 cloudflare のとき、durationMs は渡した時計の nowMs で測る", async () => {
    const clock = new FakeClock(START);
    const fetch: FetchLike = async () => {
      await clock.advance(1200);
      return new Response(JSON.stringify({ success: true, result: { choices: [{ message: { content: "{}" } }] } }), {
        status: 200,
      });
    };
    const c = createLlmClient({ llmMode: "cloudflare", cloudflare: CLOUDFLARE, fixtureDir: dir }, { clock, fetch });

    const result = await c.generate(request("aoi", 1));

    expect(result.durationMs).toBe(1200);
  });

  it("TC-UT_LLM-054 fixed のときは Cloudflare の設定があっても FixedClient を返す", () => {
    const c = createLlmClient(
      { llmMode: "fixed", cloudflare: CLOUDFLARE, fixtureDir: dir },
      { clock: new FakeClock(START) },
    );

    expect(c).toBeInstanceOf(FixedClient);
  });
});
