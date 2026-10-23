// 単体テスト（NOUS-90）。観点表は docs/test/unit/NOUS-90/観点表_lib.json
import { describe, expect, it } from "vitest";
import { loadEnv } from "./env";
import { ConfigError } from "./errors";

function problemsOf(source: Record<string, string | undefined>): string[] {
  try {
    loadEnv(source);
  } catch (err) {
    expect(err).toBeInstanceOf(ConfigError);
    return (err as ConfigError).problems;
  }
  throw new Error("ConfigError が投げられなかった");
}

describe("env（単体テスト）", () => {
  it.each([
    ["1", 1],
    ["65535", 65535],
  ])("TC-UT_LIB-016 ポートの下限・上限を受け付ける（%s）", (raw, expected) => {
    const env = loadEnv({ AISNS_ADMIN_PORT: raw });

    expect(env.adminPort).toBe(expected);
  });

  it.each(["-1", "80.5", "0x50", "8080a"])("TC-UT_LIB-017 整数の字だけでないポートはエラーにする（%s）", (raw) => {
    const problems = problemsOf({ AISNS_OBSERVER_PORT: raw });

    expect(problems.length).toBeGreaterThan(0);
    expect(problems.every((p) => p.startsWith("AISNS_OBSERVER_PORT: "))).toBe(true);
  });

  it("TC-UT_LIB-018 管理のポートだけを 8080 にすると、観察の既定のポートとぶつかってエラーにする", () => {
    const problems = problemsOf({ AISNS_ADMIN_PORT: "8080" });

    expect(problems).toEqual(["AISNS_ADMIN_PORT: AISNS_OBSERVER_PORT と別のポートにしてください"]);
  });

  it("TC-UT_LIB-019 cloudflare で アカウント ID だけがあれば、API トークンの不足だけをエラーにする", () => {
    const problems = problemsOf({ AISNS_LLM_MODE: "cloudflare", CLOUDFLARE_ACCOUNT_ID: "acc" });

    expect(problems).toEqual(["CLOUDFLARE_API_TOKEN: AISNS_LLM_MODE=cloudflare のときは必須です"]);
  });

  it("TC-UT_LIB-020 cloudflare で API トークンが空白だけなら、未設定としてエラーにする", () => {
    const problems = problemsOf({
      AISNS_LLM_MODE: "cloudflare",
      CLOUDFLARE_ACCOUNT_ID: "acc",
      CLOUDFLARE_API_TOKEN: "  ",
    });

    expect(problems).toEqual(["CLOUDFLARE_API_TOKEN: AISNS_LLM_MODE=cloudflare のときは必須です"]);
  });

  it("TC-UT_LIB-021 fixed のときは Cloudflare の認証情報があっても読まない", () => {
    const env = loadEnv({ AISNS_LLM_MODE: "fixed", CLOUDFLARE_ACCOUNT_ID: "acc", CLOUDFLARE_API_TOKEN: "tok" });

    expect(env.llmMode).toBe("fixed");
    expect(env.cloudflare).toBeNull();
  });

  it("TC-UT_LIB-022 意味の誤り（認証情報の不足・ポートの重複・production の fake）をまとめて1つの ConfigError にする", () => {
    const problems = problemsOf({
      NODE_ENV: "production",
      AISNS_LLM_MODE: "cloudflare",
      AISNS_OBSERVER_PORT: "9000",
      AISNS_ADMIN_PORT: "9000",
      AISNS_CLOCK: "fake",
    });

    expect(problems).toEqual([
      "CLOUDFLARE_ACCOUNT_ID: AISNS_LLM_MODE=cloudflare のときは必須です",
      "CLOUDFLARE_API_TOKEN: AISNS_LLM_MODE=cloudflare のときは必須です",
      "AISNS_ADMIN_PORT: AISNS_OBSERVER_PORT と別のポートにしてください",
      "AISNS_CLOCK: production では fake にできません",
    ]);
  });

  it.each(["development", "test"])("TC-UT_LIB-023 production 以外では fake の時計を受け付ける（%s）", (nodeEnv) => {
    const env = loadEnv({ NODE_ENV: nodeEnv, AISNS_CLOCK: "fake" });

    expect(env.clock).toBe("fake");
    expect(env.dbPath).toBe("data/dev.db");
  });

  it("TC-UT_LIB-024 バックアップ・固定応答の置き場所と、production の cloudflare の設定を読む", () => {
    const env = loadEnv({
      NODE_ENV: "production",
      AISNS_LLM_MODE: "cloudflare",
      CLOUDFLARE_ACCOUNT_ID: "acc",
      CLOUDFLARE_API_TOKEN: "tok",
      AISNS_BACKUP_DIR: "/var/nous/backup",
      AISNS_FIXTURE_DIR: "/tmp/fixtures",
      AISNS_LOG_LEVEL: "error",
    });

    expect(env).toEqual({
      nodeEnv: "production",
      llmMode: "cloudflare",
      cloudflare: { accountId: "acc", apiToken: "tok" },
      dbPath: "data/aisns.db",
      backupDir: "/var/nous/backup",
      observerPort: 8080,
      adminPort: 8081,
      fixtureDir: "/tmp/fixtures",
      logLevel: "error",
      clock: "system",
    });
  });
});
