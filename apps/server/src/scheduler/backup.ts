// B06 バックアップ（BE 詳細設計 world 4章 runBackup・5章・6章 BackupError、基本設計書 概要 10章）
// VACUUM INTO で data/backup/aisns-YYYYMMDD-HHMM.db にスナップショットを作り、新しい 7 世代を残して古いものを削除する
import { existsSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { Db } from "../db/client";
import type { Logger } from "../lib/logger";

/** 保持するバックアップの世代数（基本設計書 概要 10章） */
export const BACKUP_GENERATIONS = 7;

const BACKUP_FILE_PATTERN = /^aisns-\d{8}-\d{4}\.db$/;

/** バックアップの作成・世代削除で起きたエラー（world 6章。呼ぶ側が記録して処理を続ける） */
export class BackupError extends Error {
  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message, options);
    this.name = "BackupError";
  }
}

export interface BackupDeps {
  db: Db;
  backupDir: string;
  logger?: Logger;
}

/** UTC の時刻から aisns-YYYYMMDD-HHMM.db のファイル名を作る */
export function backupFileName(now: Date): string {
  const yyyy = String(now.getUTCFullYear()).padStart(4, "0");
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  const hh = String(now.getUTCHours()).padStart(2, "0");
  const min = String(now.getUTCMinutes()).padStart(2, "0");
  return `aisns-${yyyy}${mm}${dd}-${hh}${min}.db`;
}

/**
 * DB のバックアップを VACUUM INTO で作り、新しい 7 世代より古いファイルを削除する。
 * 作ったファイルのパスを返す。失敗したら BackupError を投げる
 */
export function runBackup(deps: BackupDeps, now: Date): string {
  const fileName = backupFileName(now);
  const targetPath = join(deps.backupDir, fileName);

  try {
    mkdirSync(deps.backupDir, { recursive: true });
    // VACUUM INTO は既存のファイルに上書きできないため、同じ分のファイルがあれば先に消す
    if (existsSync(targetPath)) {
      unlinkSync(targetPath);
    }
    deps.db.$client.prepare("VACUUM INTO ?").run(targetPath);

    const files = readdirSync(deps.backupDir)
      .filter((name) => BACKUP_FILE_PATTERN.test(name))
      .sort((a, b) => b.localeCompare(a));

    for (const oldFile of files.slice(BACKUP_GENERATIONS)) {
      unlinkSync(join(deps.backupDir, oldFile));
    }

    deps.logger?.info("バックアップを作成しました", { path: targetPath });
    return targetPath;
  } catch (err) {
    throw new BackupError(`バックアップに失敗しました: ${fileName}`, { cause: err });
  }
}
