// 環境変数の読み込み（基本設計書 概要 9章「環境変数一覧」「時計の差し替え」、BE 詳細設計 world 4章 createClock）
// 環境変数はこのファイルだけで読む。既定値を補い、不正な値はまとめて ConfigError にして起動を止める。
import { z } from "zod";
import { ConfigError } from "./errors.js";
import { LOG_LEVELS } from "./logger.js";

export const NODE_ENVS = ["development", "test", "production"] as const;
export const LLM_MODES = ["cloudflare", "fixed"] as const;
export const CLOCK_KINDS = ["system", "fake"] as const;

export type NodeEnv = (typeof NODE_ENVS)[number];
export type LlmMode = (typeof LLM_MODES)[number];
export type ClockKind = (typeof CLOCK_KINDS)[number];

export interface AppEnv {
  nodeEnv: NodeEnv;
  llmMode: LlmMode;
  /** llmMode が cloudflare のときだけ値がある */
  cloudflare: { accountId: string; apiToken: string } | null;
  dbPath: string;
  backupDir: string;
  observerPort: number;
  adminPort: number;
  fixtureDir: string;
  logLevel: (typeof LOG_LEVELS)[number];
  clock: ClockKind;
}

// production の DB は data/aisns.db（概要 9章「環境構成」）。それ以外は一覧の既定値 data/dev.db
const DEFAULT_DB_PATH: Record<NodeEnv, string> = {
  development: "data/dev.db",
  test: "data/dev.db",
  production: "data/aisns.db",
};

// 空の文字列は未設定として扱う
const optional = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), schema.optional());

const port = z
  .string()
  .regex(/^\d+$/, "1〜65535 の整数にしてください")
  .transform(Number)
  .refine((n) => n >= 1 && n <= 65535, "1〜65535 の整数にしてください");

const schema = z.object({
  NODE_ENV: optional(z.enum(NODE_ENVS)),
  AISNS_LLM_MODE: optional(z.enum(LLM_MODES)),
  CLOUDFLARE_ACCOUNT_ID: optional(z.string()),
  CLOUDFLARE_API_TOKEN: optional(z.string()),
  AISNS_DB_PATH: optional(z.string()),
  AISNS_BACKUP_DIR: optional(z.string()),
  AISNS_OBSERVER_PORT: optional(port),
  AISNS_ADMIN_PORT: optional(port),
  AISNS_FIXTURE_DIR: optional(z.string()),
  AISNS_LOG_LEVEL: optional(z.enum(LOG_LEVELS)),
  AISNS_CLOCK: optional(z.enum(CLOCK_KINDS)),
});

/**
 * 環境変数を読み、既定値を補って返す。不正な値があれば、すべての問題を並べた ConfigError を投げる。
 * メッセージには変数名と理由だけを書き、値（特に API トークン）は出さない。
 */
export function loadEnv(source: Record<string, string | undefined> = process.env): AppEnv {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    throw new ConfigError(parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`));
  }
  const raw = parsed.data;
  const nodeEnv = raw.NODE_ENV ?? "development";
  const llmMode = raw.AISNS_LLM_MODE ?? "fixed";
  const observerPort = raw.AISNS_OBSERVER_PORT ?? 8080;
  const adminPort = raw.AISNS_ADMIN_PORT ?? 8081;
  const clock = raw.AISNS_CLOCK ?? "system";
  const problems: string[] = [];

  if (llmMode === "cloudflare") {
    if (!raw.CLOUDFLARE_ACCOUNT_ID) problems.push("CLOUDFLARE_ACCOUNT_ID: AISNS_LLM_MODE=cloudflare のときは必須です");
    if (!raw.CLOUDFLARE_API_TOKEN) problems.push("CLOUDFLARE_API_TOKEN: AISNS_LLM_MODE=cloudflare のときは必須です");
  }
  if (observerPort === adminPort) {
    problems.push("AISNS_ADMIN_PORT: AISNS_OBSERVER_PORT と別のポートにしてください");
  }
  if (clock === "fake" && nodeEnv === "production") {
    problems.push("AISNS_CLOCK: production では fake にできません");
  }
  if (problems.length > 0) {
    throw new ConfigError(problems);
  }

  return {
    nodeEnv,
    llmMode,
    cloudflare:
      llmMode === "cloudflare"
        ? { accountId: raw.CLOUDFLARE_ACCOUNT_ID ?? "", apiToken: raw.CLOUDFLARE_API_TOKEN ?? "" }
        : null,
    dbPath: raw.AISNS_DB_PATH ?? DEFAULT_DB_PATH[nodeEnv],
    backupDir: raw.AISNS_BACKUP_DIR ?? "data/backup",
    observerPort,
    adminPort,
    fixtureDir: raw.AISNS_FIXTURE_DIR ?? "fixtures/llm",
    logLevel: raw.AISNS_LOG_LEVEL ?? "info",
    clock,
  };
}
