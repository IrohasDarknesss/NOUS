// drizzle-kit の設定（pnpm db:generate・pnpm db:migrate）。DB 物理設計書 7章
// DB のファイルは AISNS_DB_PATH（既定 data/dev.db。基本設計書 13章）。相対パスはリポジトリの直下から数える
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { defineConfig } from "drizzle-kit";

// pnpm --filter @nous/server で動かすので、カレントは apps/server
const repoRoot = resolve(process.cwd(), "../..");
const dbPath = resolve(repoRoot, process.env.AISNS_DB_PATH ?? "data/dev.db");
mkdirSync(dirname(dbPath), { recursive: true });

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dbCredentials: { url: dbPath },
});
