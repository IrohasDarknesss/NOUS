// B08 生存時刻の記録と空白の補正（BE 詳細設計 world 4章 beat・5章、基本設計書 概要 4章 B08）
// 稼働中 60 秒ごとに heartbeat_at を更新し、180 秒を超える空白があれば世界内時間を補正し、予定を過ぎていれば 1巡を起こす
import { and, eq } from "drizzle-orm";
import type { Clock } from "../clock/clock";
import type { Db } from "../db/client";
import { worlds } from "../db/schema";
import type { Logger } from "../lib/logger";
import { findCurrentWorld, type SchedulerControl } from "../world/worldService";
import { heartbeatPatch } from "../world/worldTime";

/** 生存時刻を記録する間隔（60 秒、world 4章・5章） */
export const HEARTBEAT_INTERVAL_MS = 60_000;

export interface HeartbeatDeps {
  db: Db;
  clock: Clock;
  scheduler: Pick<SchedulerControl, "wake">;
  logger: Logger;
}

export interface HeartbeatResult {
  updated: boolean;
  corrected: boolean;
  woke: boolean;
}

/**
 * 1回分の生存時刻の記録とスリープ復帰の補正。
 * 1. 現在の世界が running でなければ何もしない
 * 2. heartbeatPatch を worlds に書き、running_since が変わっていればスリープ補正として warn を記録
 * 3. next_cycle_at があって now がそれ以降なら scheduler.wake()
 */
export function beat(deps: HeartbeatDeps, now: Date): HeartbeatResult {
  const world = findCurrentWorld(deps.db);
  if (!world) {
    return { updated: false, corrected: false, woke: false };
  }

  const patch = heartbeatPatch(world, now);
  if (patch === null) {
    return { updated: false, corrected: false, woke: false };
  }

  const updated = deps.db
    .update(worlds)
    .set(patch)
    .where(and(eq(worlds.world_id, world.world_id), eq(worlds.state, "running")))
    .run();

  if (updated.changes === 0) {
    return { updated: false, corrected: false, woke: false };
  }

  const corrected = patch.running_since !== world.running_since;
  if (corrected) {
    deps.logger.warn("スリープからの復帰を検知し、世界内時間を補正しました", {
      worldId: world.world_id,
      previousHeartbeatAt: world.heartbeat_at,
      worldElapsedSec: patch.world_elapsed_sec,
    });
  }

  let woke = false;
  if (world.next_cycle_at !== null && now.getTime() >= Date.parse(world.next_cycle_at)) {
    deps.scheduler.wake();
    woke = true;
  }

  return { updated: true, corrected, woke };
}

/**
 * 60 秒ごとに beat を呼ぶタイマーを張る。例外は記録して止めない。戻り値は解除の関数
 */
export function scheduleHeartbeat(deps: HeartbeatDeps): () => void {
  return deps.clock.setRepeatingTimer(HEARTBEAT_INTERVAL_MS, () => {
    try {
      beat(deps, deps.clock.now());
    } catch (err) {
      deps.logger.error("生存時刻の記録に失敗しました", { err });
    }
  });
}
