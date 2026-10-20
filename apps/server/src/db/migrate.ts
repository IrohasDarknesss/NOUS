// マイグレーションの適用（DB 物理設計書 7章）。pnpm db:migrate は drizzle-kit で同じ migrations/ を適用する。
// 起動時とテスト用の DB の作成では、この runMigrations を使う
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import type { Db } from "./client";

/** マイグレーションのファイルの置き場所 */
export const MIGRATIONS_FOLDER = fileURLToPath(new URL("./migrations", import.meta.url));

/** 未適用のマイグレーションを順に適用する（適用済みなら何もしない） */
export function runMigrations(db: Db): void {
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}
