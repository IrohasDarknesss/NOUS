// B02 日の区切り（BE 詳細設計 world 4章 rolloverDay・5章・6章、基本設計書 概要 4章 BT-002）
// 00:00 UTC ごとに新しい利用日の集計行を作り、上限停止の世界を稼働に戻し、バックアップを取る
import { and, eq } from "drizzle-orm";
import { onUtcMidnight, utcDate, type Clock } from "../clock/clock";
import type { Db } from "../db/client";
import { daily_metrics, daily_usage, worlds } from "../db/schema";
import { withTx } from "../db/tx";
import type { Logger } from "../lib/logger";
import { findCurrentWorld, type SchedulerControl } from "../world/worldService";
import { runBackup } from "./backup";

export interface DayRolloverDeps {
  db: Db;
  clock: Clock;
  scheduler: Pick<SchedulerControl, "wake">;
  backupDir: string;
  logger: Logger;
}

export interface DayRolloverResult {
  usageDate: string;
  resumed: boolean;
  backupPath: string | null;
}

/**
 * 00:00 UTC の日の区切りの処理。
 * 1. daily_usage と現在の世界の daily_metrics を 0 で作成（INSERT OR IGNORE）
 * 2. 世界が limit_stopped なら running に戻し、トランザクションの後に scheduler.wake()
 * 3. トランザクションの外で runBackup（失敗しても記録して続ける）
 */
export function rolloverDay(deps: DayRolloverDeps, now: Date): DayRolloverResult {
  const usageDate = utcDate(now);
  const nowIso = now.toISOString();

  const resumed = withTx(deps.db, (tx) => {
    tx.insert(daily_usage).values({ usage_date: usageDate }).onConflictDoNothing().run();

    const world = findCurrentWorld(tx);
    if (!world) {
      return false;
    }

    tx.insert(daily_metrics).values({ world_id: world.world_id, usage_date: usageDate }).onConflictDoNothing().run();

    if (world.state !== "limit_stopped") {
      return false;
    }

    const updated = tx
      .update(worlds)
      .set({
        state: "running",
        running_since: nowIso,
        heartbeat_at: nowIso,
        stop_reason: null,
      })
      .where(and(eq(worlds.world_id, world.world_id), eq(worlds.state, "limit_stopped")))
      .run();

    return updated.changes > 0;
  });

  if (resumed) {
    deps.scheduler.wake();
  }

  let backupPath: string | null = null;
  try {
    backupPath = runBackup({ db: deps.db, backupDir: deps.backupDir, logger: deps.logger }, now);
  } catch (err) {
    deps.logger.error("日次バックアップに失敗しました", { usageDate, err });
  }

  deps.logger.info("日の区切りの処理を完了しました", { usageDate, resumed, backupPath });
  return { usageDate, resumed, backupPath };
}

/**
 * 00:00 UTC ごとに rolloverDay を呼ぶタイマーを張る。例外は記録して止めない。戻り値は解除の関数
 */
export function scheduleDayRollover(deps: DayRolloverDeps): () => void {
  return onUtcMidnight(deps.clock, () => {
    try {
      rolloverDay(deps, deps.clock.now());
    } catch (err) {
      deps.logger.error("日の区切りの処理に失敗しました", { err });
    }
  });
}
