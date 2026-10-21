import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../../test/helpers/testDb";
import { encodeCursor } from "../../lib/cursor";
import { AppError } from "../../lib/errors";
import { searchPosts, type SearchPostsFilters } from "./postQueryService";
import { postIdOf, seedAgent, seedArchivedWorld, seedPost, seedWorld } from "./moderationTestSupport";

function catchAppError(fn: () => unknown): AppError {
  try {
    fn();
  } catch (err) {
    if (err instanceof AppError) {
      return err;
    }
    throw err;
  }
  throw new Error("AppError が投げられませんでした");
}

describe("searchPosts（admin/moderation/postQueryService）", () => {
  let t: TestDb;
  let worldId: string;
  let minato: string;
  let haruka: string;

  beforeEach(() => {
    t = createTestDb();
    worldId = seedWorld(t.db);
    minato = seedAgent(t.db, worldId, "minato");
    haruka = seedAgent(t.db, worldId, "haruka");
  });

  afterEach(() => {
    t.cleanup();
  });

  function search(filters: Partial<SearchPostsFilters> = {}, targetWorldId = worldId) {
    return searchPosts(t.db, targetWorldId, { limit: 50, ...filters });
  }

  it("TC-NOUS66_DEV-01 world_time_sec の降順・post_id の降順で返し、投稿者・返信先・生成イベント ID を AdminPostItem の形で付ける", () => {
    const old = seedPost(t.db, { worldId, agentId: minato, postId: postIdOf(1), body: "古い投稿", worldTimeSec: 100 });
    const reply = seedPost(t.db, {
      worldId,
      agentId: haruka,
      postId: postIdOf(2),
      body: "返信です",
      worldTimeSec: 300,
      replyToPostId: old.postId,
      createdAt: "2026-10-22T09:05:00.000Z",
    });
    const mid = seedPost(t.db, { worldId, agentId: minato, postId: postIdOf(3), body: "間の投稿", worldTimeSec: 200 });

    const res = search();

    expect(res.nextCursor).toBeNull();
    expect(res.items.map((i) => i.postId)).toEqual([reply.postId, mid.postId, old.postId]);
    expect(res.items[0]).toEqual({
      postId: reply.postId,
      body: "返信です",
      visibility: "public",
      worldTimeSec: 300,
      createdAt: "2026-10-22T09:05:00.000Z",
      agent: { agentId: haruka, displayName: "haruka" },
      replyToPostId: old.postId,
      generationEventId: reply.eventId,
    });
    expect(res.items[2]).toMatchObject({ replyToPostId: null, agent: { agentId: minato, displayName: "minato" } });
  });

  it("TC-NOUS66_DEV-02 同じ world_time_sec の投稿を含めてページ送りしても、重複も欠落もなく新しい順に全件が並ぶ", () => {
    const times = [10, 20, 20, 20, 30];
    times.forEach((worldTimeSec, i) => {
      seedPost(t.db, { worldId, agentId: minato, postId: postIdOf(i + 1), worldTimeSec });
    });
    const expected = [5, 4, 3, 2, 1].map(postIdOf);

    const collected: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const res = search({ limit: 2, cursor });
      collected.push(...res.items.map((i) => i.postId));
      cursor = res.nextCursor ?? undefined;
      pages += 1;
      expect(pages).toBeLessThanOrEqual(3);
    } while (cursor !== undefined);

    expect(pages).toBe(3);
    expect(collected).toEqual(expected);
  });

  it("TC-NOUS66_DEV-03 件数が limit ちょうどなら nextCursor は null、limit+1 件目があれば最後に返す行の (world_time_sec, post_id) から作る", () => {
    seedPost(t.db, { worldId, agentId: minato, postId: postIdOf(1), worldTimeSec: 10 });
    seedPost(t.db, { worldId, agentId: minato, postId: postIdOf(2), worldTimeSec: 20 });

    expect(search({ limit: 2 }).nextCursor).toBeNull();

    const first = search({ limit: 1 });
    expect(first.items.map((i) => i.postId)).toEqual([postIdOf(2)]);
    expect(first.nextCursor).toBe(encodeCursor(["20", postIdOf(2)]));
  });

  it("TC-NOUS66_DEV-04 q は本文の部分一致で絞り込む（一致しなければ空）", () => {
    seedPost(t.db, { worldId, agentId: minato, postId: postIdOf(1), body: "今日は天気がいいですね", worldTimeSec: 10 });
    seedPost(t.db, { worldId, agentId: minato, postId: postIdOf(2), body: "雨が降ってきました", worldTimeSec: 20 });

    expect(search({ q: "天気" }).items.map((i) => i.postId)).toEqual([postIdOf(1)]);
    expect(search({ q: "が" }).items).toHaveLength(2);
    expect(search({ q: "雪" })).toEqual({ items: [], nextCursor: null });
  });

  it("TC-NOUS66_DEV-05 q の % は文字どおりの % として部分一致する（ワイルドカードにならない）", () => {
    seedPost(t.db, { worldId, agentId: minato, postId: postIdOf(1), body: "達成率は100%でした", worldTimeSec: 10 });
    seedPost(t.db, { worldId, agentId: minato, postId: postIdOf(2), body: "ふつうの投稿", worldTimeSec: 20 });

    expect(search({ q: "%" }).items.map((i) => i.postId)).toEqual([postIdOf(1)]);
    expect(search({ q: "0%で" }).items.map((i) => i.postId)).toEqual([postIdOf(1)]);
  });

  it("TC-NOUS66_DEV-06 q の _ は文字どおりの _ として部分一致する（任意の 1 文字にならない）", () => {
    seedPost(t.db, { worldId, agentId: minato, postId: postIdOf(1), body: "ファイル名は a_b です", worldTimeSec: 10 });
    seedPost(t.db, { worldId, agentId: minato, postId: postIdOf(2), body: "ファイル名は axb です", worldTimeSec: 20 });

    expect(search({ q: "a_b" }).items.map((i) => i.postId)).toEqual([postIdOf(1)]);
    expect(search({ q: "_" }).items.map((i) => i.postId)).toEqual([postIdOf(1)]);
  });

  it("TC-NOUS66_DEV-07 q の \\ は文字どおりの \\ として部分一致する（ESCAPE の文字自身も逃がす）", () => {
    seedPost(t.db, { worldId, agentId: minato, postId: postIdOf(1), body: "パスは C:\\temp です", worldTimeSec: 10 });
    seedPost(t.db, { worldId, agentId: minato, postId: postIdOf(2), body: "パスは C:temp です", worldTimeSec: 20 });
    seedPost(t.db, { worldId, agentId: minato, postId: postIdOf(3), body: "100% と a_b", worldTimeSec: 30 });

    expect(search({ q: "\\" }).items.map((i) => i.postId)).toEqual([postIdOf(1)]);
    expect(search({ q: "C:\\t" }).items.map((i) => i.postId)).toEqual([postIdOf(1)]);
    // % _ \ を続けて含む q も、そのままの文字列として探す
    expect(search({ q: "%_\\" }).items).toEqual([]);
    expect(search({ q: "0% と a_b" }).items.map((i) => i.postId)).toEqual([postIdOf(3)]);
  });

  it("TC-NOUS66_DEV-08 visibility で public・hidden に絞り込む（指定がなければ非表示も含む）", () => {
    seedPost(t.db, { worldId, agentId: minato, postId: postIdOf(1), worldTimeSec: 10, visibility: "public" });
    seedPost(t.db, { worldId, agentId: minato, postId: postIdOf(2), worldTimeSec: 20, visibility: "hidden" });

    expect(search().items.map((i) => i.postId)).toEqual([postIdOf(2), postIdOf(1)]);
    expect(search({ visibility: "hidden" }).items.map((i) => i.postId)).toEqual([postIdOf(2)]);
    expect(search({ visibility: "public" }).items.map((i) => i.postId)).toEqual([postIdOf(1)]);
  });

  it("TC-NOUS66_DEV-09 agentId でそのエージェントの投稿だけに絞り込み、q・visibility と組み合わせられる", () => {
    seedPost(t.db, { worldId, agentId: minato, postId: postIdOf(1), body: "ミナトの朝", worldTimeSec: 10 });
    seedPost(t.db, { worldId, agentId: haruka, postId: postIdOf(2), body: "ハルカの朝", worldTimeSec: 20 });
    seedPost(t.db, {
      worldId,
      agentId: minato,
      postId: postIdOf(3),
      body: "ミナトの夜",
      worldTimeSec: 30,
      visibility: "hidden",
    });

    expect(search({ agentId: minato }).items.map((i) => i.postId)).toEqual([postIdOf(3), postIdOf(1)]);
    expect(search({ agentId: haruka }).items.map((i) => i.postId)).toEqual([postIdOf(2)]);
    expect(search({ agentId: minato, q: "朝" }).items.map((i) => i.postId)).toEqual([postIdOf(1)]);
    expect(search({ agentId: minato, visibility: "hidden" }).items.map((i) => i.postId)).toEqual([postIdOf(3)]);
  });

  it("TC-NOUS66_DEV-10 postId を指定するとその投稿だけを返し、同じ世界の中の投稿に限る", () => {
    seedPost(t.db, { worldId, agentId: minato, postId: postIdOf(1), worldTimeSec: 10 });
    seedPost(t.db, { worldId, agentId: minato, postId: postIdOf(2), worldTimeSec: 20 });
    const archivedId = seedArchivedWorld(t.db);
    const archivedAgent = seedAgent(t.db, archivedId, "oldminato");
    seedPost(t.db, { worldId: archivedId, agentId: archivedAgent, postId: postIdOf(9), worldTimeSec: 90 });

    expect(search({ postId: postIdOf(1) }).items.map((i) => i.postId)).toEqual([postIdOf(1)]);
    expect(search({ postId: postIdOf(9) })).toEqual({ items: [], nextCursor: null });
    expect(search({ postId: postIdOf(9) }, archivedId).items.map((i) => i.postId)).toEqual([postIdOf(9)]);
    expect(search({ postId: postIdOf(77) })).toEqual({ items: [], nextCursor: null });
  });

  it("TC-NOUS66_DEV-11 別の世界（archived）の投稿は出ず、worldId にその世界を渡せばその世界の投稿だけが出る", () => {
    seedPost(t.db, { worldId, agentId: minato, postId: postIdOf(1), body: "いまの世界", worldTimeSec: 10 });
    const archivedId = seedArchivedWorld(t.db);
    const archivedAgent = seedAgent(t.db, archivedId, "oldminato");
    seedPost(t.db, {
      worldId: archivedId,
      agentId: archivedAgent,
      postId: postIdOf(2),
      body: "昔の世界",
      worldTimeSec: 999,
    });

    expect(search().items.map((i) => i.body)).toEqual(["いまの世界"]);
    expect(search({ q: "昔" })).toEqual({ items: [], nextCursor: null });
    expect(search({}, archivedId).items.map((i) => i.body)).toEqual(["昔の世界"]);
  });

  it.each([
    ["TC-NOUS66_DEV-12", "2 要素でない（1 要素）", encodeCursor(["10"])],
    ["TC-NOUS66_DEV-13", "2 要素でない（3 要素）", encodeCursor(["10", postIdOf(1), "x"])],
    ["TC-NOUS66_DEV-14", "world_time_sec が整数でない（文字）", encodeCursor(["abc", postIdOf(1)])],
    ["TC-NOUS66_DEV-15", "world_time_sec が整数でない（小数）", encodeCursor(["1.5", postIdOf(1)])],
    ["TC-NOUS66_DEV-16", "Base64URL として読めない", "!!!"],
  ])("%s 不正なカーソル（%s）は 400 VALIDATION_ERROR（fields.cursor）", (_id, _label, cursor) => {
    seedPost(t.db, { worldId, agentId: minato, postId: postIdOf(1), worldTimeSec: 10 });

    const err = catchAppError(() => search({ cursor }));

    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.status).toBe(400);
    expect(err.fields).toEqual({ cursor: "カーソルが正しくありません" });
  });
});
