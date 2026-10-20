// 世界内時間の計算と確定（BE 詳細設計 world 4章 getWorldTimeSec・settleWorldTime・beat・recoverOnStartup）
// 世界内時間は、running の間だけ進む。world_elapsed_sec に確定した秒、running_since から現在までが確定前の分
import { and, eq } from "drizzle-orm";
import { worlds } from "../db/schema";
import type { Tx } from "../db/tx";

type WorldTimeState = NonNullable<(typeof worlds.$inferInsert)["state"]>;

/** 世界内時間の計算に使う worlds の列 */
export interface WorldTimeFields {
  state: string;
  world_elapsed_sec: number;
  running_since: string | null;
  heartbeat_at: string | null;
}

/** 生存時刻がこの秒数より古ければ、スリープ（プロセスの停止）があったとみなす（B08） */
export const HEARTBEAT_GAP_SEC = 180;

const elapsedSec = (fromIso: string, to: Date): number =>
  Math.max(0, Math.floor((to.getTime() - Date.parse(fromIso)) / 1000));

/** running なら world_elapsed_sec＋floor((now − running_since)/1000)、それ以外は world_elapsed_sec */
export function getWorldTimeSec(world: WorldTimeFields, now: Date): number {
  if (world.state !== "running" || world.running_since === null) return world.world_elapsed_sec;
  return world.world_elapsed_sec + elapsedSec(world.running_since, now);
}

/**
 * running から離れるときに世界内時間を確定する。world_elapsed_sec に書き、running_since を NULL にする。
 * worlds の CHECK（running のときだけ running_since がある）のため、遷移先の state（next）も同じ UPDATE で書く。
 * world_id と state が読んだときのままでなければ書かずに null を返す（楽観の確認。world 3章 updateWorldState）
 */
export function settleWorldTime(
  tx: Tx,
  world: WorldTimeFields & { world_id: string },
  now: Date,
  next: Partial<Omit<typeof worlds.$inferInsert, "world_id" | "world_elapsed_sec" | "running_since">> & {
    state: Exclude<(typeof worlds.$inferInsert)["state"], "running" | undefined>;
  },
): number | null {
  const sec = getWorldTimeSec(world, now);
  const result = tx
    .update(worlds)
    .set({ ...next, world_elapsed_sec: sec, running_since: null })
    .where(and(eq(worlds.world_id, world.world_id), eq(worlds.state, world.state as WorldTimeState)))
    .run();
  return result.changes === 0 ? null : sec;
}

/** スリープからの復帰の補正で書き換える列 */
export interface WorldTimePatch {
  world_elapsed_sec: number;
  running_since: string;
  heartbeat_at: string;
}

/**
 * B08 の生存時刻の補正。running で、生存時刻が HEARTBEAT_GAP_SEC を超えて古ければ、
 * 最後の生存時刻までを世界内時間に足し、running_since を now にする（止まっていた間は数えない）。
 * 補正がなければ heartbeat_at だけを now にする。running でなければ null
 */
export function heartbeatPatch(world: WorldTimeFields, now: Date): WorldTimePatch | null {
  if (world.state !== "running" || world.running_since === null) return null;
  const nowIso = now.toISOString();
  const heartbeat = world.heartbeat_at ?? world.running_since;
  if (elapsedSec(heartbeat, now) > HEARTBEAT_GAP_SEC) {
    return {
      world_elapsed_sec: world.world_elapsed_sec + secBetween(world.running_since, heartbeat),
      running_since: nowIso,
      heartbeat_at: nowIso,
    };
  }
  return { world_elapsed_sec: world.world_elapsed_sec, running_since: world.running_since, heartbeat_at: nowIso };
}

/**
 * B07 の起動時の補正。running のまま止まっていた世界は、最後の生存時刻までを世界内時間に足し、
 * running_since と heartbeat_at を now にする。running でなければ null
 */
export function startupPatch(world: WorldTimeFields, now: Date): WorldTimePatch | null {
  if (world.state !== "running" || world.running_since === null) return null;
  const nowIso = now.toISOString();
  const heartbeat = world.heartbeat_at ?? world.running_since;
  return {
    world_elapsed_sec: world.world_elapsed_sec + secBetween(world.running_since, heartbeat),
    running_since: nowIso,
    heartbeat_at: nowIso,
  };
}

/** from から to（ISO）までの秒。to が前なら 0 */
function secBetween(fromIso: string, toIso: string): number {
  return elapsedSec(fromIso, new Date(Date.parse(toIso)));
}
