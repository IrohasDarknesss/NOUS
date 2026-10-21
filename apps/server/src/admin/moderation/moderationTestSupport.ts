// 投稿の検索・非表示のテストの下ごしらえ（世界・エージェント・投稿を DB に入れる）。テストからだけ使う
import { posts, worlds } from "../../db/schema";
import type { Db } from "../../db/client";
import { SEED_NOW, seedAgent, seedEvent, seedWorld } from "../../../test/helpers/generationSeed";

export { seedAgent, seedWorld };

/** 並びが ID の順と一致する 26 字の投稿 ID（n が大きいほど新しい ID） */
export function postIdOf(n: number): string {
  return `01POST${String(n).padStart(20, "0")}`;
}

let archivedCounter = 0;

/** archived の世界（現在の世界ではない）を作る */
export function seedArchivedWorld(db: Db, name = "過去の世界"): string {
  archivedCounter += 1;
  const worldId = `01ARCH${String(archivedCounter).padStart(20, "0")}`;
  db.insert(worlds)
    .values({ world_id: worldId, name, state: "archived", archived_at: SEED_NOW, created_at: SEED_NOW })
    .run();
  return worldId;
}

let cycleCounter = 0;

export interface SeedPostOptions {
  worldId: string;
  agentId: string;
  /** 投稿 ID（26 字）。並びを見るテストでは postIdOf で渡す */
  postId: string;
  body?: string;
  worldTimeSec?: number;
  visibility?: "public" | "hidden";
  replyToPostId?: string | null;
  createdAt?: string;
}

/** 生成イベントと投稿を 1 件入れて、投稿 ID と生成イベント ID を返す */
export function seedPost(db: Db, o: SeedPostOptions): { postId: string; eventId: string } {
  cycleCounter += 1;
  const eventId = seedEvent(db, o.worldId, o.agentId, cycleCounter, o.worldTimeSec ?? 0);
  db.insert(posts)
    .values({
      post_id: o.postId,
      world_id: o.worldId,
      agent_id: o.agentId,
      body: o.body ?? "テスト投稿",
      reply_to_post_id: o.replyToPostId ?? null,
      root_post_id: o.replyToPostId ? o.replyToPostId : o.postId,
      depth: o.replyToPostId ? 1 : 0,
      visibility: o.visibility ?? "public",
      world_time_sec: o.worldTimeSec ?? 0,
      created_at: o.createdAt ?? SEED_NOW,
      generation_event_id: eventId,
    })
    .run();
  return { postId: o.postId, eventId };
}
