import { describe, expect, it } from "vitest";
import { loadEnv } from "./env.js";
import { ConfigError } from "./errors.js";

function problemsOf(source: Record<string, string | undefined>): string[] {
  try {
    loadEnv(source);
  } catch (err) {
    if (err instanceof ConfigError) return err.problems;
    throw err;
  }
  throw new Error("ConfigError が投げられなかった");
}

describe("env", () => {
  it("TC-NOUS44_DEV-23 何も設定しなければ概要 9章の既定値になる", () => {
    expect(loadEnv({})).toEqual({
      nodeEnv: "development",
      llmMode: "fixed",
      cloudflare: null,
      dbPath: "data/dev.db",
      backupDir: "data/backup",
      observerPort: 8080,
      adminPort: 8081,
      fixtureDir: "fixtures/llm",
      logLevel: "info",
      clock: "system",
    });
  });

  it("TC-NOUS44_DEV-24 設定した値を読み、ポートを数値にする", () => {
    const env = loadEnv({
      NODE_ENV: "test",
      AISNS_DB_PATH: "/tmp/t.db",
      AISNS_OBSERVER_PORT: "18080",
      AISNS_ADMIN_PORT: "18081",
      AISNS_LOG_LEVEL: "warn",
      AISNS_CLOCK: "fake",
    });
    expect(env).toMatchObject({
      nodeEnv: "test",
      dbPath: "/tmp/t.db",
      observerPort: 18080,
      adminPort: 18081,
      logLevel: "warn",
      clock: "fake",
    });
  });

  it("TC-NOUS44_DEV-25 空の文字列は未設定として既定値にする", () => {
    expect(loadEnv({ NODE_ENV: "", AISNS_OBSERVER_PORT: " " })).toMatchObject({
      nodeEnv: "development",
      observerPort: 8080,
    });
  });

  it("TC-NOUS44_DEV-26 production の DB の既定は data/aisns.db", () => {
    expect(loadEnv({ NODE_ENV: "production" }).dbPath).toBe("data/aisns.db");
  });

  it("TC-NOUS44_DEV-27 cloudflare のときは認証情報を読み、なければエラーにする", () => {
    const env = loadEnv({ AISNS_LLM_MODE: "cloudflare", CLOUDFLARE_ACCOUNT_ID: "acc", CLOUDFLARE_API_TOKEN: "tok" });
    expect(env.cloudflare).toEqual({ accountId: "acc", apiToken: "tok" });
    const problems = problemsOf({ AISNS_LLM_MODE: "cloudflare" });
    expect(problems.some((p) => p.startsWith("CLOUDFLARE_ACCOUNT_ID"))).toBe(true);
    expect(problems.some((p) => p.startsWith("CLOUDFLARE_API_TOKEN"))).toBe(true);
  });

  it("TC-NOUS44_DEV-28 列挙の外の値・範囲外のポートをまとめてエラーにする", () => {
    const problems = problemsOf({
      NODE_ENV: "staging",
      AISNS_LLM_MODE: "openai",
      AISNS_LOG_LEVEL: "trace",
      AISNS_CLOCK: "real",
      AISNS_OBSERVER_PORT: "0",
      AISNS_ADMIN_PORT: "abc",
    });
    for (const name of [
      "NODE_ENV",
      "AISNS_LLM_MODE",
      "AISNS_LOG_LEVEL",
      "AISNS_CLOCK",
      "AISNS_OBSERVER_PORT",
      "AISNS_ADMIN_PORT",
    ]) {
      expect(problems.some((p) => p.startsWith(name))).toBe(true);
    }
    expect(problemsOf({ AISNS_ADMIN_PORT: "65536" }).some((p) => p.startsWith("AISNS_ADMIN_PORT"))).toBe(true);
  });

  it("TC-NOUS44_DEV-29 観察と管理のポートが同じならエラーにする", () => {
    expect(problemsOf({ AISNS_OBSERVER_PORT: "9000", AISNS_ADMIN_PORT: "9000" })).toHaveLength(1);
  });

  it("TC-NOUS44_DEV-30 production で fake の時計はエラーにする", () => {
    expect(problemsOf({ NODE_ENV: "production", AISNS_CLOCK: "fake" })[0]).toMatch(/^AISNS_CLOCK/);
  });

  it("TC-NOUS44_DEV-31 エラーのメッセージに API トークンの値を出さない", () => {
    try {
      loadEnv({ AISNS_LLM_MODE: "cloudflare", CLOUDFLARE_API_TOKEN: "very-secret-token", AISNS_ADMIN_PORT: "x" });
      throw new Error("ConfigError が投げられなかった");
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      expect((err as Error).message).not.toContain("very-secret-token");
    }
  });
});
