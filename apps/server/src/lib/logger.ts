// JSON 行のロガー（BE 詳細設計 admin_auth 1章・4章 redactSecrets、基本設計書 概要 8章「機密情報管理」「サーバーのエラー」）
// トークン・パスワード・セッション ID・Cookie などの秘密のキーは、入れ子の中でも値を '***' に伏せる。
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export const REDACTED = "***";

// 比べるときはキーを小文字にし、- と _ を外す（例: X-CSRF-Token → xcsrftoken、api_token → apitoken）
const SECRET_KEYS = new Set([
  "password",
  "token",
  "apitoken",
  "sessionid",
  "csrftoken",
  "xcsrftoken",
  "authorization",
  "cookie",
  "setcookie",
]);
const SECRET_SUFFIXES = ["token", "password", "secret"];

export function isSecretKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[-_]/g, "");
  return SECRET_KEYS.has(normalized) || SECRET_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
}

/** 秘密のキーの値を '***' に置き換えた複製を返す（元の値は変えない） */
export function redactSecrets<T>(record: T): T {
  return redactValue(record, new WeakSet()) as T;
}

function redactValue(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (seen.has(value)) {
    return "[Circular]";
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  // seen は今たどっている経路だけを持つ（同じ値を2か所から指すだけなら循環とみなさない）
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item) => redactValue(item, seen));
    }
    const source =
      value instanceof Error ? { ...value, name: value.name, message: value.message, stack: value.stack } : value;
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(source)) {
      out[key] = isSecretKey(key) ? REDACTED : redactValue(item, seen);
    }
    return out;
  } finally {
    seen.delete(value);
  }
}

export type LogFields = Record<string, unknown>;
export type LogSink = (line: string) => void;

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  /** 決まった項目（例: { module: "scheduler" }）を毎行に付けたロガーを作る */
  child(bindings: LogFields): Logger;
}

export interface LoggerOptions {
  level?: LogLevel;
  /** 1 行（改行なし）を受け取る出力先。既定は標準出力 */
  sinks?: LogSink[];
  /** 時刻の取得。Clock を通すときに渡す */
  now?: () => Date;
  bindings?: LogFields;
}

export const stdoutSink: LogSink = (line) => {
  process.stdout.write(`${line}\n`);
};

/** ファイルに追記する出力先（例: logs/app.log）。ディレクトリがなければ作る */
export function fileSink(path: string): LogSink {
  mkdirSync(dirname(path), { recursive: true });
  return (line) => {
    appendFileSync(path, `${line}\n`, "utf8");
  };
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const threshold = LOG_LEVELS.indexOf(options.level ?? "info");
  const sinks = options.sinks ?? [stdoutSink];
  const now = options.now ?? (() => new Date());
  const bindings = options.bindings ?? {};

  const write = (level: LogLevel, msg: string, fields?: LogFields): void => {
    if (LOG_LEVELS.indexOf(level) < threshold) {
      return;
    }
    const record = redactSecrets({ ...bindings, ...fields });
    const line = JSON.stringify({ time: now().toISOString(), level, msg, ...record });
    for (const sink of sinks) {
      sink(line);
    }
  };

  return {
    debug: (msg, fields) => write("debug", msg, fields),
    info: (msg, fields) => write("info", msg, fields),
    warn: (msg, fields) => write("warn", msg, fields),
    error: (msg, fields) => write("error", msg, fields),
    child: (extra) => createLogger({ ...options, bindings: { ...bindings, ...extra } }),
  };
}
