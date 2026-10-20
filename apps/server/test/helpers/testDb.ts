// テスト用の DB：一時ディレクトリにファイルの DB を作り、マイグレーションを適用する。cleanup で閉じて消す
// （テスト計画「DB：IT はテストごとに一時ファイルを作り直す」）
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDb, openDb, type Db } from "../../src/db/client";
import { runMigrations } from "../../src/db/migrate";

export interface TestDb {
  db: Db;
  /** DB のファイルのパス */
  path: string;
  /** DB を閉じ、一時ディレクトリごと消す（何度呼んでもよい） */
  cleanup: () => void;
}

export function createTestDb(): TestDb {
  const dir = mkdtempSync(join(tmpdir(), "nous-test-"));
  const path = join(dir, "test.db");
  const db = openDb(path);
  try {
    runMigrations(db);
  } catch (err) {
    closeDb(db);
    rmSync(dir, { recursive: true, force: true });
    throw err;
  }
  return {
    db,
    path,
    cleanup: () => {
      closeDb(db);
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
