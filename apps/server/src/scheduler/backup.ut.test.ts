// 単体テスト（NOUS-98）。観点表は docs/test/unit/NOUS-98/観点表_daily.json
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { captureLogger } from "../../test/helpers/adminTestSupport";
import { createTestDb, type TestDb } from "../../test/helpers/testDb";
import { closeDb } from "../db/client";
import { BackupError, backupFileName, runBackup } from "./backup";

let t: TestDb;
let backupDir: string;

beforeEach(() => {
  t = createTestDb();
  backupDir = mkdtempSync(join(tmpdir(), "nous-backup-ut-"));
});

afterEach(() => {
  t.cleanup();
  rmSync(backupDir, { recursive: true, force: true });
});

/** 2026-10-<day> 00:00 UTC の時刻 */
const day = (d: number): Date => new Date(`2026-10-${String(d).padStart(2, "0")}T00:00:00.000Z`);

function backupFiles(): string[] {
  return readdirSync(backupDir)
    .filter((f) => f.startsWith("aisns-"))
    .sort();
}

describe("backup（単体テスト）", () => {
  it("TC-UT_SCH-029 バックアップがちょうど 7 件のときは 1 件も消さない", () => {
    for (let d = 1; d <= 7; d++) runBackup({ db: t.db, backupDir }, day(d));

    const files = backupFiles();

    expect(files).toHaveLength(7);
    expect(files[0]).toBe("aisns-20261001-0000.db");
    expect(files[6]).toBe("aisns-20261007-0000.db");
  });

  it("TC-UT_SCH-030 名前の形が aisns-YYYYMMDD-HHMM.db でないファイルは世代に数えず、消さない", () => {
    const others = ["aisns-2026-10-01.db", "aisns-20261001-000.db", "aisns-20261001-0000.db.bak", "other.db"];
    for (const name of others) writeFileSync(join(backupDir, name), "keep");

    for (let d = 1; d <= 8; d++) runBackup({ db: t.db, backupDir }, day(d));

    const all = readdirSync(backupDir);
    const generations = all.filter((f) => /^aisns-\d{8}-\d{4}\.db$/.test(f)).sort();
    expect(generations).toHaveLength(7);
    expect(generations[0]).toBe("aisns-20261002-0000.db");
    for (const name of others) expect(all).toContain(name);
  });

  it.each([
    ["2026-10-22T23:59:59.999Z", "aisns-20261022-2359.db"],
    ["2026-12-31T23:59:00.000Z", "aisns-20261231-2359.db"],
    ["2027-01-01T00:00:00.000Z", "aisns-20270101-0000.db"],
  ])("TC-UT_SCH-031 backupFileName は UTC の分までで名前を作り、秒以下は切り捨てる（%s → %s）", (iso, expected) => {
    const name = backupFileName(new Date(iso));

    expect(name).toBe(expected);
  });

  it("TC-UT_SCH-032 失敗したときの BackupError は name が BackupError で、メッセージに作ろうとしたファイル名を含む", () => {
    closeDb(t.db);

    let caught: unknown;
    try {
      runBackup({ db: t.db, backupDir }, day(22));
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(BackupError);
    expect((caught as BackupError).name).toBe("BackupError");
    expect((caught as BackupError).message).toContain("aisns-20261022-0000.db");
  });

  it("TC-UT_SCH-033 logger を渡すと、作ったファイルのパスを info で記録する", () => {
    const { logger, lines } = captureLogger();

    const path = runBackup({ db: t.db, backupDir, logger }, day(22));

    const info = lines().find((l) => l.level === "info");
    expect(path).toBe(join(backupDir, "aisns-20261022-0000.db"));
    expect(JSON.stringify(info)).toContain("aisns-20261022-0000.db");
  });
});
