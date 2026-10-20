import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../test/helpers/testDb";
import { closeDb } from "../db/client";
import { withTx } from "../db/tx";
import { createInitialWorld } from "../world/worldService";
import { BACKUP_GENERATIONS, BackupError, backupFileName, runBackup } from "./backup";

let t: TestDb;
let backupDir: string;

beforeEach(() => {
  t = createTestDb();
  backupDir = mkdtempSync(join(tmpdir(), "nous-backup-test-"));
});

afterEach(() => {
  t.cleanup();
  rmSync(backupDir, { recursive: true, force: true });
});

describe("backup", () => {
  it("TC-NOUS60_DEV-01 backupFileName は UTC の時刻から aisns-YYYYMMDD-HHMM.db の形式を返す", () => {
    expect(backupFileName(new Date("2026-10-22T00:00:00.000Z"))).toBe("aisns-20261022-0000.db");
    expect(backupFileName(new Date("2026-01-05T09:07:59.999Z"))).toBe("aisns-20260105-0907.db");
  });

  it("TC-NOUS60_DEV-02 runBackup でバックアップファイルが作られ、同じ分の再実行でも上書きできる", () => {
    const now = new Date("2026-10-22T00:00:00.000Z");
    const world = withTx(t.db, (tx) => createInitialWorld(tx, now));

    const nestedDir = join(backupDir, "nested");
    const firstPath = runBackup({ db: t.db, backupDir: nestedDir }, now);
    expect(firstPath).toBe(join(nestedDir, "aisns-20261022-0000.db"));
    expect(existsSync(firstPath)).toBe(true);

    // 同じ分の時刻でもう一度呼んでも VACUUM INTO が失敗しない
    const secondPath = runBackup({ db: t.db, backupDir: nestedDir }, now);
    expect(secondPath).toBe(firstPath);

    const copied = new Database(secondPath, { readonly: true });
    try {
      const row = copied.prepare("SELECT world_id, name FROM worlds").get() as {
        world_id: string;
        name: string;
      };
      expect(row).toEqual({ world_id: world.world_id, name: world.name });
    } finally {
      copied.close();
    }
  });

  it("TC-NOUS60_DEV-03 8 件以上あると古いものから消えて新しい 7 件だけが残る", () => {
    // 関係ないファイルは削除されないこともあわせて確かめる
    writeFileSync(join(backupDir, "README.txt"), "keep");

    const dates = [
      new Date("2026-10-15T00:00:00.000Z"),
      new Date("2026-10-16T00:00:00.000Z"),
      new Date("2026-10-17T00:00:00.000Z"),
      new Date("2026-10-18T00:00:00.000Z"),
      new Date("2026-10-19T00:00:00.000Z"),
      new Date("2026-10-20T00:00:00.000Z"),
      new Date("2026-10-21T00:00:00.000Z"),
      new Date("2026-10-22T00:00:00.000Z"),
      new Date("2026-10-23T00:00:00.000Z"),
    ];

    for (const d of dates) {
      runBackup({ db: t.db, backupDir }, d);
    }

    const allFiles = readdirSync(backupDir).sort();
    const backups = allFiles.filter((f) => f.startsWith("aisns-"));
    expect(backups).toHaveLength(BACKUP_GENERATIONS);
    expect(backups).toEqual([
      "aisns-20261017-0000.db",
      "aisns-20261018-0000.db",
      "aisns-20261019-0000.db",
      "aisns-20261020-0000.db",
      "aisns-20261021-0000.db",
      "aisns-20261022-0000.db",
      "aisns-20261023-0000.db",
    ]);
    expect(allFiles).toContain("README.txt");
  });

  it("TC-NOUS60_DEV-04 失敗したときは原因を cause に持つ BackupError を投げる", () => {
    closeDb(t.db);
    try {
      runBackup({ db: t.db, backupDir }, new Date("2026-10-22T00:00:00.000Z"));
      throw new Error("BackupError が投げられませんでした");
    } catch (err) {
      expect(err).toBeInstanceOf(BackupError);
      expect((err as BackupError).cause).toBeDefined();
    }
  });
});
