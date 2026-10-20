// B07 起動時の後始末（BE 詳細設計 world 3章 closeOrphanEvents・4章 recoverOnStartup・5章・6章、基本設計書 概要 4章 B07）
// 前回の終了時に running のまま残った生成イベントを interrupted で閉じ、running の世界の世界内時間を補正し、期限切れのセッションを削除する
import { and, eq } from "drizzle-orm";
import { deleteExpiredSessions } from "../admin/middleware/sessionAuth";
import type { Clock } from "../clock/clock";
import type { Db } from "../db/client";
import { generation_events, worlds } from "../db/schema";
import { withTx } from "../db/tx";
import type { Logger } from "../lib/logger";
import { findCurrentWorld } from "../world/worldService";
import { startupPatch } from "../world/worldTime";

export interface StartupRecoveryDeps {
  db: Db;
  clock: Clock;
  logger?: Logger;
}

export interface StartupRecoveryResult {
  closedEvents: number;
  worldPatched: boolean;
  deletedSessions: number;
}

/**
 * プロセスの起動時の後始末（1 トランザクション）。
 * 1. status='running' の generation_events を全件 interrupted で閉じる
 * 2. 現在の世界が running なら、最後の生存時刻（heartbeat_at）までを世界内時間に足し、running_since と heartbeat_at を now にする
 * 3. 期限切れの管理セッションを削除する
 */
export function recoverOnStartup(deps: StartupRecoveryDeps, now: Date): StartupRecoveryResult {
  const nowIso = now.toISOString();

  const result = withTx(deps.db, (tx) => {
    const closed = tx
      .update(generation_events)
      .set({
        status: "interrupted",
        failure_kind: "interrupted",
        finished_at: nowIso,
      })
      .where(eq(generation_events.status, "running"))
      .run();

    let worldPatched = false;
    const world = findCurrentWorld(tx);
    if (world) {
      const patch = startupPatch(world, now);
      if (patch !== null) {
        const updated = tx
          .update(worlds)
          .set(patch)
          .where(and(eq(worlds.world_id, world.world_id), eq(worlds.state, "running")))
          .run();
        worldPatched = updated.changes > 0;
      }
    }

    const deletedSessions = deleteExpiredSessions(tx, deps.clock);

    return {
      closedEvents: closed.changes,
      worldPatched,
      deletedSessions,
    };
  });

  deps.logger?.info("起動時の後始末を完了しました", { ...result });
  return result;
}
