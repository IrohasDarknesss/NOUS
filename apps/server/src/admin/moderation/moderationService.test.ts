import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TEST_ADMIN_ID, TEST_NOW, seedAdmin } from "../../../test/helpers/adminTestSupport";
import { createTestDb, type TestDb } from "../../../test/helpers/testDb";
import { FakeClock } from "../../clock/fakeClock";
import { admin_audit_logs, hide_records, posts, worlds } from "../../db/schema";
import { encodeCursor } from "../../lib/cursor";
import { AppError } from "../../lib/errors";
import { hidePost, listHideHistory, unhidePost } from "./moderationService";
import { postIdOf, seedAgent, seedArchivedWorld, seedPost, seedWorld } from "./moderationTestSupport";

const ADMIN = { adminId: TEST_ADMIN_ID };
/** admin_account にいない管理者（recordAudit の外部キー違反で、監査の記録を失敗させる） */
const MISSING_ADMIN = { adminId: "01JB0000000000000MISSING00" };

function catchError(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error("例外が投げられませんでした");
}

function catchAppError(fn: () => unknown): AppError {
  const err = catchError(fn);
  if (err instanceof AppError) {
    return err;
  }
  throw err;
}

function hideIdOf(n: number): string {
  return `01HIDE${String(n).padStart(20, "0")}`;
}

describe("moderationService（admin/moderation/moderationService）", () => {
  let t: TestDb;
  let clock: FakeClock;
  let worldId: string;
  let agentId: string;

  beforeEach(() => {
    t = createTestDb();
    clock = new FakeClock(TEST_NOW);
    seedAdmin(t.db, TEST_NOW);
    worldId = seedWorld(t.db);
    agentId = seedAgent(t.db, worldId, "minato");
  });

  afterEach(() => {
    t.cleanup();
  });

  function visibilityOf(postId: string): string | undefined {
    return t.db.select({ v: posts.visibility }).from(posts).where(eq(posts.post_id, postId)).get()?.v;
  }

  function hideRows() {
    return t.db.select().from(hide_records).all();
  }

  /** 現在の世界を archived にして、現在の世界がない状態にする */
  function archiveWorld(id: string): void {
    t.db
      .update(worlds)
      .set({ state: "archived", archived_at: "2026-10-22T10:00:00.000Z" })
      .where(eq(worlds.world_id, id))
      .run();
  }

  function auditRows() {
    return t.db.select().from(admin_audit_logs).all();
  }

  function insertHideRecord(
    n: number,
    postId: string,
    operatedAt: string,
    operation: "hide" | "unhide" = "hide",
    reason = "",
  ) {
    t.db
      .insert(hide_records)
      .values({ hide_id: hideIdOf(n), post_id: postId, operation, reason, operated_at: operatedAt })
      .run();
  }

  it("TC-NOUS66_DEV-17 hidePost は現在の世界の公開中の投稿を hidden にし、hide_records（hide）と監査（post.hide）を残して { postId, visibility: 'hidden' } を返す", () => {
    const { postId } = seedPost(t.db, { worldId, agentId, postId: postIdOf(1), body: "非表示にする投稿" });

    const res = hidePost(t.db, clock, postId, "不適切な内容", ADMIN);

    expect(res).toEqual({ postId, visibility: "hidden" });
    expect(visibilityOf(postId)).toBe("hidden");

    const records = hideRows();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      post_id: postId,
      operation: "hide",
      reason: "不適切な内容",
      operated_at: TEST_NOW.toISOString(),
    });
    expect(records[0]?.hide_id).toHaveLength(26);

    const audits = auditRows();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      admin_id: TEST_ADMIN_ID,
      operation: "post.hide",
      target_type: "post",
      target_id: postId,
      world_id: worldId,
      operated_at: TEST_NOW.toISOString(),
    });
    expect(JSON.parse(audits[0]?.before_json ?? "null")).toEqual({ visibility: "public" });
    expect(JSON.parse(audits[0]?.after_json ?? "null")).toEqual({ visibility: "hidden", reason: "不適切な内容" });
  });

  it("TC-NOUS66_DEV-18 hidePost は reason を省略すると空文字で hide_records と監査に残す", () => {
    const { postId } = seedPost(t.db, { worldId, agentId, postId: postIdOf(1) });

    hidePost(t.db, clock, postId, undefined, ADMIN);

    expect(hideRows()[0]?.reason).toBe("");
    expect(JSON.parse(auditRows()[0]?.after_json ?? "null")).toEqual({ visibility: "hidden", reason: "" });
  });

  it("TC-NOUS66_DEV-19 hidePost は存在しない投稿で 404 POST_NOT_FOUND を投げ、何も記録しない", () => {
    seedPost(t.db, { worldId, agentId, postId: postIdOf(1) });

    const err = catchAppError(() => hidePost(t.db, clock, postIdOf(99), "理由", ADMIN));

    expect(err.code).toBe("POST_NOT_FOUND");
    expect(err.status).toBe(404);
    expect(hideRows()).toHaveLength(0);
    expect(auditRows()).toHaveLength(0);
  });

  it("TC-NOUS66_DEV-20 hidePost は別の世界（archived）の投稿に 404 POST_NOT_FOUND を投げ、投稿は変わらない", () => {
    const archivedId = seedArchivedWorld(t.db);
    const archivedAgent = seedAgent(t.db, archivedId, "oldminato");
    const { postId } = seedPost(t.db, { worldId: archivedId, agentId: archivedAgent, postId: postIdOf(5) });

    const err = catchAppError(() => hidePost(t.db, clock, postId, "理由", ADMIN));

    expect(err.code).toBe("POST_NOT_FOUND");
    expect(visibilityOf(postId)).toBe("public");
    expect(hideRows()).toHaveLength(0);
    expect(auditRows()).toHaveLength(0);
  });

  it("TC-NOUS66_DEV-21 hidePost・unhidePost は現在の世界がない（すべて archived）と 404 POST_NOT_FOUND を投げる", () => {
    const { postId } = seedPost(t.db, { worldId, agentId, postId: postIdOf(1) });
    archiveWorld(worldId);

    expect(catchAppError(() => hidePost(t.db, clock, postId, undefined, ADMIN)).code).toBe("POST_NOT_FOUND");
    expect(catchAppError(() => unhidePost(t.db, clock, postId, undefined, ADMIN)).code).toBe("POST_NOT_FOUND");
    expect(hideRows()).toHaveLength(0);
    expect(auditRows()).toHaveLength(0);
  });

  it("TC-NOUS66_DEV-22 hidePost はすでに hidden の投稿に 409 ALREADY_HIDDEN を投げ、記録を増やさない", () => {
    const { postId } = seedPost(t.db, { worldId, agentId, postId: postIdOf(1), visibility: "hidden" });

    const err = catchAppError(() => hidePost(t.db, clock, postId, "理由", ADMIN));

    expect(err.code).toBe("ALREADY_HIDDEN");
    expect(err.status).toBe(409);
    expect(visibilityOf(postId)).toBe("hidden");
    expect(hideRows()).toHaveLength(0);
    expect(auditRows()).toHaveLength(0);
  });

  it("TC-NOUS66_DEV-23 unhidePost は hidden の投稿を public に戻し、hide_records（unhide）と監査（post.unhide）を残して { postId, visibility: 'public' } を返す", () => {
    const { postId } = seedPost(t.db, { worldId, agentId, postId: postIdOf(1), visibility: "hidden" });

    const res = unhidePost(t.db, clock, postId, "誤って非表示にした", ADMIN);

    expect(res).toEqual({ postId, visibility: "public" });
    expect(visibilityOf(postId)).toBe("public");

    const records = hideRows();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      post_id: postId,
      operation: "unhide",
      reason: "誤って非表示にした",
      operated_at: TEST_NOW.toISOString(),
    });

    const audits = auditRows();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      admin_id: TEST_ADMIN_ID,
      operation: "post.unhide",
      target_type: "post",
      target_id: postId,
      world_id: worldId,
    });
    expect(JSON.parse(audits[0]?.before_json ?? "null")).toEqual({ visibility: "hidden" });
    expect(JSON.parse(audits[0]?.after_json ?? "null")).toEqual({ visibility: "public", reason: "誤って非表示にした" });
  });

  it("TC-NOUS66_DEV-24 unhidePost は public の投稿に 409 NOT_HIDDEN、存在しない投稿・別の世界の投稿に 404 POST_NOT_FOUND を投げ、何も記録しない", () => {
    const { postId } = seedPost(t.db, { worldId, agentId, postId: postIdOf(1) });
    const archivedId = seedArchivedWorld(t.db);
    const archivedAgent = seedAgent(t.db, archivedId, "oldminato");
    const other = seedPost(t.db, {
      worldId: archivedId,
      agentId: archivedAgent,
      postId: postIdOf(5),
      visibility: "hidden",
    });

    const notHidden = catchAppError(() => unhidePost(t.db, clock, postId, undefined, ADMIN));
    expect(notHidden.code).toBe("NOT_HIDDEN");
    expect(notHidden.status).toBe(409);

    expect(catchAppError(() => unhidePost(t.db, clock, postIdOf(99), undefined, ADMIN)).code).toBe("POST_NOT_FOUND");
    expect(catchAppError(() => unhidePost(t.db, clock, other.postId, undefined, ADMIN)).code).toBe("POST_NOT_FOUND");

    expect(visibilityOf(postId)).toBe("public");
    expect(visibilityOf(other.postId)).toBe("hidden");
    expect(hideRows()).toHaveLength(0);
    expect(auditRows()).toHaveLength(0);
  });

  it("TC-NOUS66_DEV-25 hidePost は監査の記録が失敗したら、posts の UPDATE と hide_records の INSERT も取り消して元のままにする", () => {
    const { postId } = seedPost(t.db, { worldId, agentId, postId: postIdOf(1) });

    const err = catchError(() => hidePost(t.db, clock, postId, "理由", MISSING_ADMIN));

    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(AppError);
    expect(visibilityOf(postId)).toBe("public");
    expect(hideRows()).toHaveLength(0);
    expect(auditRows()).toHaveLength(0);
  });

  it("TC-NOUS66_DEV-26 unhidePost は監査の記録が失敗したら、posts の UPDATE と hide_records の INSERT も取り消して元のままにする", () => {
    const { postId } = seedPost(t.db, { worldId, agentId, postId: postIdOf(1), visibility: "hidden" });

    const err = catchError(() => unhidePost(t.db, clock, postId, "理由", MISSING_ADMIN));

    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(AppError);
    expect(visibilityOf(postId)).toBe("hidden");
    expect(hideRows()).toHaveLength(0);
    expect(auditRows()).toHaveLength(0);
  });

  it("TC-NOUS66_DEV-27 hidePost は hide_records の INSERT が失敗しても（reason が 201 字）posts の UPDATE を取り消し、監査も残さない", () => {
    const { postId } = seedPost(t.db, { worldId, agentId, postId: postIdOf(1) });

    const err = catchError(() => hidePost(t.db, clock, postId, "あ".repeat(201), ADMIN));

    expect(err).toBeInstanceOf(Error);
    expect(visibilityOf(postId)).toBe("public");
    expect(hideRows()).toHaveLength(0);
    expect(auditRows()).toHaveLength(0);
  });

  it("TC-NOUS66_DEV-28 hidePost → unhidePost → hidePost と続けて操作でき、そのたびに hide_records と監査が 1 件ずつ増える", () => {
    const { postId } = seedPost(t.db, { worldId, agentId, postId: postIdOf(1) });

    hidePost(t.db, clock, postId, "1回目", ADMIN);
    unhidePost(t.db, clock, postId, "戻す", ADMIN);
    hidePost(t.db, clock, postId, "2回目", ADMIN);

    expect(visibilityOf(postId)).toBe("hidden");
    expect(
      hideRows()
        .map((r) => r.operation)
        .sort(),
    ).toEqual(["hide", "hide", "unhide"]);
    expect(
      auditRows()
        .map((r) => r.operation)
        .sort(),
    ).toEqual(["post.hide", "post.hide", "post.unhide"]);
  });

  it("TC-NOUS66_DEV-29 listHideHistory は operated_at の降順・hide_id の降順で返し、同じ operated_at を含めてページ送りしても重複・欠落がない", () => {
    const { postId } = seedPost(t.db, { worldId, agentId, postId: postIdOf(1), body: "履歴の対象" });
    const same = "2026-10-22T09:00:00.000Z";
    insertHideRecord(1, postId, "2026-10-22T08:00:00.000Z", "hide", "一番古い");
    insertHideRecord(2, postId, same, "unhide", "同時刻 A");
    insertHideRecord(3, postId, same, "hide", "同時刻 B");
    insertHideRecord(4, postId, same, "unhide", "同時刻 C");
    insertHideRecord(5, postId, "2026-10-22T10:00:00.000Z", "hide", "一番新しい");

    const all = listHideHistory(t.db, { limit: 50 });
    expect(all.nextCursor).toBeNull();
    expect(all.items.map((i) => i.hideId)).toEqual([5, 4, 3, 2, 1].map(hideIdOf));
    expect(all.items[0]).toEqual({
      hideId: hideIdOf(5),
      postId,
      operation: "hide",
      reason: "一番新しい",
      operatedAt: "2026-10-22T10:00:00.000Z",
      postBodyExcerpt: "履歴の対象",
    });

    const collected: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const res = listHideHistory(t.db, { limit: 2, cursor });
      collected.push(...res.items.map((i) => i.hideId));
      cursor = res.nextCursor ?? undefined;
      pages += 1;
      expect(pages).toBeLessThanOrEqual(3);
    } while (cursor !== undefined);
    expect(pages).toBe(3);
    expect(collected).toEqual([5, 4, 3, 2, 1].map(hideIdOf));

    const first = listHideHistory(t.db, { limit: 1 });
    expect(first.nextCursor).toBe(encodeCursor(["2026-10-22T10:00:00.000Z", hideIdOf(5)]));
  });

  it("TC-NOUS66_DEV-30 listHideHistory は postBodyExcerpt を本文の先頭 40 字（文字単位）に切り、40 字以下はそのまま返す", () => {
    const long = seedPost(t.db, { worldId, agentId, postId: postIdOf(1), body: `${"あ".repeat(40)}ここは切られる` });
    const exact = seedPost(t.db, { worldId, agentId, postId: postIdOf(2), body: "い".repeat(40) });
    const short = seedPost(t.db, { worldId, agentId, postId: postIdOf(3), body: "短い本文" });
    const emoji = seedPost(t.db, { worldId, agentId, postId: postIdOf(4), body: "😀".repeat(45) });
    insertHideRecord(1, long.postId, "2026-10-22T09:01:00.000Z");
    insertHideRecord(2, exact.postId, "2026-10-22T09:02:00.000Z");
    insertHideRecord(3, short.postId, "2026-10-22T09:03:00.000Z");
    insertHideRecord(4, emoji.postId, "2026-10-22T09:04:00.000Z");

    const items = listHideHistory(t.db, { limit: 50 }).items;
    const excerptOf = (postId: string) => items.find((i) => i.postId === postId)?.postBodyExcerpt;

    expect(excerptOf(long.postId)).toBe("あ".repeat(40));
    expect(excerptOf(exact.postId)).toBe("い".repeat(40));
    expect(excerptOf(short.postId)).toBe("短い本文");
    // サロゲートペアを壊さず、40 文字（= 40 個の絵文字）で切る
    expect(excerptOf(emoji.postId)).toBe("😀".repeat(40));
    expect(Array.from(excerptOf(emoji.postId) ?? "")).toHaveLength(40);
  });

  it("TC-NOUS66_DEV-31 listHideHistory は別の世界（archived）の投稿の履歴を返さず、現在の世界がなければ空を返す", () => {
    const current = seedPost(t.db, { worldId, agentId, postId: postIdOf(1), body: "いまの世界の投稿" });
    const archivedId = seedArchivedWorld(t.db);
    const archivedAgent = seedAgent(t.db, archivedId, "oldminato");
    const old = seedPost(t.db, { worldId: archivedId, agentId: archivedAgent, postId: postIdOf(2), body: "昔の投稿" });
    insertHideRecord(1, current.postId, "2026-10-22T09:00:00.000Z");
    insertHideRecord(2, old.postId, "2026-10-22T09:30:00.000Z");

    const res = listHideHistory(t.db, { limit: 50 });
    expect(res.items.map((i) => i.postId)).toEqual([current.postId]);

    archiveWorld(worldId);
    expect(listHideHistory(t.db, { limit: 50 })).toEqual({ items: [], nextCursor: null });
  });

  it.each([
    ["TC-NOUS66_DEV-32", "2 要素でない", encodeCursor(["2026-10-22T09:00:00.000Z"])],
    ["TC-NOUS66_DEV-33", "operated_at が日時でない", encodeCursor(["abc", hideIdOf(1)])],
    ["TC-NOUS66_DEV-34", "Base64URL として読めない", "!!!"],
  ])(
    "%s listHideHistory は不正なカーソル（%s）に 400 VALIDATION_ERROR（fields.cursor）を投げる",
    (_id, _label, cursor) => {
      const { postId } = seedPost(t.db, { worldId, agentId, postId: postIdOf(1) });
      insertHideRecord(1, postId, "2026-10-22T09:00:00.000Z");

      const err = catchAppError(() => listHideHistory(t.db, { limit: 50, cursor }));

      expect(err.code).toBe("VALIDATION_ERROR");
      expect(err.status).toBe(400);
      expect(err.fields).toEqual({ cursor: "カーソルが正しくありません" });
    },
  );
});
