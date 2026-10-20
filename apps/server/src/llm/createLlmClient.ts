// AISNS_LLM_MODE で LlmClient の実装を選ぶ（BE 詳細設計 generation 2章 LlmClient.generate のビジネスロジック 1）。
// llmClient.ts に置くと cloudflareClient・fixedClient と循環して読み込むので、別のファイルにする。
import { createCloudflareClient, type FetchLike } from "./cloudflareClient.js";
import { createFixedClient, type LlmClock } from "./fixedClient.js";
import type { LlmClient } from "./llmClient.js";

export type LlmClientEnv = {
  llmMode: "cloudflare" | "fixed";
  /** llmMode が cloudflare のときだけ値がある（lib/env.ts の AppEnv と同じ形） */
  cloudflare: { accountId: string; apiToken: string } | null;
  fixtureDir: string;
};

export type CreateLlmClientOptions = {
  clock: LlmClock & { nowMs(): number };
  /** 固定応答のシナリオの名前。既定は basic */
  fixtureScenario?: string;
  /** テストで Cloudflare の fetch を差し替える */
  fetch?: FetchLike;
};

export const DEFAULT_FIXTURE_SCENARIO = "basic";

export function createLlmClient(env: LlmClientEnv, options: CreateLlmClientOptions): LlmClient {
  if (env.llmMode === "cloudflare") {
    if (env.cloudflare === null) {
      // env.ts が起動時に止めるので、ここに来るのはプログラムの誤り。トークンの値は出さない
      throw new Error("AISNS_LLM_MODE=cloudflare ですが、Cloudflare の設定がありません");
    }
    return createCloudflareClient({
      accountId: env.cloudflare.accountId,
      apiToken: env.cloudflare.apiToken,
      fetch: options.fetch,
      nowMs: () => options.clock.nowMs(),
    });
  }
  return createFixedClient({
    fixtureDir: env.fixtureDir,
    scenario: options.fixtureScenario ?? DEFAULT_FIXTURE_SCENARIO,
    clock: options.clock,
  });
}
