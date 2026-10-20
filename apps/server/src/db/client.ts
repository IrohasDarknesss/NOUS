// openDb：SQLite を開き、PRAGMA を設定して Drizzle の DB を返す（DB 物理設計書 1章「接続の設定」、BE 詳細設計 admin_auth 1章）
import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

export type Db = BetterSQLite3Database<typeof schema> & { $client: Database.Database };

/** busy_timeout（ミリ秒）。書き込みのロックを待つ上限 */
export const BUSY_TIMEOUT_MS = 5000;

/** AISNS_DB_PATH の既定（基本設計書 13章） */
export const DEFAULT_DB_PATH = "data/dev.db";

/** リポジトリの直下（apps/server/src/db から 4 つ上） */
const repoRoot = (): string => fileURLToPath(new URL("../../../../", import.meta.url));

/** DB のファイルのパスを決める。相対パスはリポジトリの直下から数える（drizzle.config.ts と同じ） */
export function resolveDbPath(raw: string | undefined = process.env.AISNS_DB_PATH): string {
  const p = raw && raw.length > 0 ? raw : DEFAULT_DB_PATH;
  if (p === ":memory:" || isAbsolute(p)) return p;
  return resolve(repoRoot(), p);
}

/**
 * DB を開く。接続ごとに foreign_keys = ON、journal_mode = WAL、busy_timeout = 5000 を設定する。
 * ファイルの置き場所のディレクトリがなければ作る。
 */
export function openDb(filePath: string = resolveDbPath()): Db {
  if (filePath !== ":memory:") mkdirSync(dirname(filePath), { recursive: true });
  const sqlite = new Database(filePath);
  try {
    sqlite.pragma("foreign_keys = ON");
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma(`busy_timeout = ${BUSY_TIMEOUT_MS}`);
  } catch (err) {
    sqlite.close();
    throw err;
  }
  return drizzle(sqlite, { schema });
}

/** openDb で開いた DB を閉じる */
export function closeDb(db: Db): void {
  if (db.$client.open) db.$client.close();
}
