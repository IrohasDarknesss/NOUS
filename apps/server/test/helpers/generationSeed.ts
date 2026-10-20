// 行動生成のテストの準備：世界・エージェント・生成イベントを入れる（NOUS-62）
import { agents, generation_events, worlds } from "../../src/db/schema";
import type { Db } from "../../src/db/client";
import { newUlid } from "../../src/lib/ids";

export const SEED_NOW = "2026-10-22T09:00:00.000Z";
export const SEED_DATE = "2026-10-22";

export function seedWorld(db: Db): string {
  const worldId = newUlid();
  db.insert(worlds).values({ world_id: worldId, name: "テストの世界", created_at: SEED_NOW }).run();
  return worldId;
}

export function seedAgent(
  db: Db,
  worldId: string,
  handle: string,
  options: { personality?: string; state?: "active" | "stopped" } = {},
): string {
  const agentId = newUlid();
  db.insert(agents)
    .values({
      agent_id: agentId,
      world_id: worldId,
      handle,
      display_name: handle,
      interests: "散歩",
      topics: "街",
      personality: options.personality ?? "穏やか",
      values_text: "誠実",
      stance: "中立",
      state: options.state ?? "active",
      created_at: SEED_NOW,
      updated_at: SEED_NOW,
    })
    .run();
  return agentId;
}

/** running の生成イベントを作る（posts・likes・follows が参照する） */
export function seedEvent(db: Db, worldId: string, agentId: string, cycleNo = 1, worldTimeSec = 0): string {
  const eventId = newUlid();
  db.insert(generation_events)
    .values({
      event_id: eventId,
      world_id: worldId,
      agent_id: agentId,
      cycle_no: cycleNo,
      cycle_seed: 101,
      decided_by: "llm",
      model_id: "@cf/google/gemma-4-26b-a4b-it",
      prompt_version: "v1",
      llm_mode: "fixed",
      world_time_sec: worldTimeSec,
      started_at: SEED_NOW,
      usage_date: SEED_DATE,
    })
    .run();
  return eventId;
}
