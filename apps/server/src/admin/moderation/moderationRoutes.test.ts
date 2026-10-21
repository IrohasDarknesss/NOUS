import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TEST_ADMIN_ID, TEST_NOW, seedAdmin, seedSession, testDeps } from "../../../test/helpers/adminTestSupport";
import { createTestDb, type TestDb } from "../../../test/helpers/testDb";
import { FakeClock } from "../../clock/fakeClock";
import { admin_audit_logs, hide_records, posts, worlds } from "../../db/schema";
import { encodeCursor } from "../../lib/cursor";
import { createAdminApp } from "../adminServer";
import { CSRF_HEADER } from "../middleware/csrf";
import { ADMIN_COOKIE } from "../middleware/sessionAuth";
import { postIdOf, seedAgent, seedArchivedWorld, seedPost, seedWorld } from "./moderationTestSupport";

interface ErrorBody {
  error: { code: string; message: string; fields: Record<string, string> };
}

describe("moderationRoutes（/admin/api/posts・/admin/api/hide-records）", () => {
  let t: TestDb;
  let clock: FakeClock;
  let cookie: string;
  let csrfToken: string;
  let worldId: string;
  let agentId: string;

  beforeEach(() => {
    t = createTestDb();
    clock = new FakeClock(TEST_NOW);
    seedAdmin(t.db, TEST_NOW);
    const s = seedSession(t.db, TEST_NOW);
    cookie = `${ADMIN_COOKIE}=${s.cookie}`;
    csrfToken = s.csrfToken;
    worldId = seedWorld(t.db);
    agentId = seedAgent(t.db, worldId, "minato");
  });

  afterEach(() => {
    t.cleanup();
  });

  function app() {
    return createAdminApp(testDeps(t.db, clock), { staticDir: null });
  }

  function getJson(path: string) {
    return app().request(path, { headers: { Cookie: cookie } });
  }

  function postJson(path: string, body?: string) {
    return app().request(path, {
      method: "POST",
      headers: { Cookie: cookie, [CSRF_HEADER]: csrfToken, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body }),
    });
  }

  function visibilityOf(postId: string): string | undefined {
    return t.db.select({ v: posts.visibility }).from(posts).where(eq(posts.post_id, postId)).get()?.v;
  }

  function hideRows() {
    return t.db.select().from(hide_records).all();
  }

  function auditRows() {
    return t.db.select().from(admin_audit_logs).all();
  }

  function seedOtherWorldPost(postId: string, visibility: "public" | "hidden" = "public") {
    const archivedId = seedArchivedWorld(t.db);
    const archivedAgent = seedAgent(t.db, archivedId, "oldminato");
    return seedPost(t.db, { worldId: archivedId, agentId: archivedAgent, postId, body: "昔の世界の投稿", visibility });
  }

  it("TC-NOUS66_DEV-35 GET /admin/api/posts は現在の世界の投稿を新しい順に { items, nextCursor } で 200 で返し、非表示も含み、別の世界の投稿は含まない", async () => {
    const a = seedPost(t.db, { worldId, agentId, postId: postIdOf(1), body: "公開の投稿", worldTimeSec: 100 });
    const b = seedPost(t.db, {
      worldId,
      agentId,
      postId: postIdOf(2),
      body: "非表示の投稿",
      worldTimeSec: 200,
      visibility: "hidden",
    });
    seedOtherWorldPost(postIdOf(9));

    const res = await getJson("/admin/api/posts");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      items: [
        {
          postId: b.postId,
          body: "非表示の投稿",
          visibility: "hidden",
          worldTimeSec: 200,
          createdAt: "2026-10-22T09:00:00.000Z",
          agent: { agentId, displayName: "minato" },
          replyToPostId: null,
          generationEventId: b.eventId,
        },
        {
          postId: a.postId,
          body: "公開の投稿",
          visibility: "public",
          worldTimeSec: 100,
          createdAt: "2026-10-22T09:00:00.000Z",
          agent: { agentId, displayName: "minato" },
          replyToPostId: null,
          generationEventId: a.eventId,
        },
      ],
      nextCursor: null,
    });
  });

  it("TC-NOUS66_DEV-36 GET /admin/api/posts は q（% _ \\ を文字どおりに）・visibility・agentId・postId で絞り込める", async () => {
    const other = seedAgent(t.db, worldId, "haruka");
    seedPost(t.db, { worldId, agentId, postId: postIdOf(1), body: "達成率は100%でした", worldTimeSec: 10 });
    seedPost(t.db, {
      worldId,
      agentId,
      postId: postIdOf(2),
      body: "達成率は100ぱーせんと",
      worldTimeSec: 20,
      visibility: "hidden",
    });
    seedPost(t.db, { worldId, agentId: other, postId: postIdOf(3), body: "a_b と C:\\temp", worldTimeSec: 30 });

    const ids = async (query: string) => {
      const res = await getJson(`/admin/api/posts?${query}`);
      expect(res.status).toBe(200);
      return ((await res.json()) as { items: { postId: string }[] }).items.map((i) => i.postId);
    };

    expect(await ids(`q=${encodeURIComponent("%")}`)).toEqual([postIdOf(1)]);
    expect(await ids(`q=${encodeURIComponent("a_b")}`)).toEqual([postIdOf(3)]);
    expect(await ids(`q=${encodeURIComponent("\\")}`)).toEqual([postIdOf(3)]);
    expect(await ids("visibility=hidden")).toEqual([postIdOf(2)]);
    expect(await ids(`agentId=${other}`)).toEqual([postIdOf(3)]);
    expect(await ids(`postId=${postIdOf(1)}`)).toEqual([postIdOf(1)]);
    expect(await ids(`q=${encodeURIComponent("達成率")}&agentId=${agentId}&visibility=public`)).toEqual([postIdOf(1)]);
  });

  it("TC-NOUS66_DEV-37 GET /admin/api/posts は limit と nextCursor でページ送りでき、同じ world_time_sec の投稿も重複・欠落しない", async () => {
    [10, 20, 20, 20, 30].forEach((worldTimeSec, i) => {
      seedPost(t.db, { worldId, agentId, postId: postIdOf(i + 1), worldTimeSec });
    });

    const collected: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res = await getJson(`/admin/api/posts?limit=2${cursor ? `&cursor=${cursor}` : ""}`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { items: { postId: string }[]; nextCursor: string | null };
      collected.push(...body.items.map((i) => i.postId));
      cursor = body.nextCursor;
      pages += 1;
      expect(pages).toBeLessThanOrEqual(3);
    } while (cursor !== null);

    expect(pages).toBe(3);
    expect(collected).toEqual([5, 4, 3, 2, 1].map(postIdOf));
  });

  it("TC-NOUS66_DEV-38 GET /admin/api/posts は現在の世界がなければ { items: [], nextCursor: null } を 200 で返す", async () => {
    seedPost(t.db, { worldId, agentId, postId: postIdOf(1) });
    t.db
      .update(worlds)
      .set({ state: "archived", archived_at: "2026-10-22T10:00:00.000Z" })
      .where(eq(worlds.world_id, worldId))
      .run();

    const res = await getJson("/admin/api/posts");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [], nextCursor: null });
  });

  it.each([
    ["TC-NOUS66_DEV-39", "q が空", "q="],
    ["TC-NOUS66_DEV-40", "q が 51 字", `q=${"あ".repeat(51)}`],
    ["TC-NOUS66_DEV-41", "visibility が public・hidden 以外", "visibility=secret"],
    ["TC-NOUS66_DEV-42", "agentId が 26 字でない", "agentId=short"],
    ["TC-NOUS66_DEV-43", "postId が 26 字でない", "postId=short"],
    ["TC-NOUS66_DEV-44", "limit が 0", "limit=0"],
    ["TC-NOUS66_DEV-45", "limit が 101", "limit=101"],
    ["TC-NOUS66_DEV-46", "limit が整数でない", "limit=abc"],
    ["TC-NOUS66_DEV-47", "cursor が Base64URL でない", "cursor=!!!"],
    ["TC-NOUS66_DEV-48", "cursor が 2 要素でない", `cursor=${encodeCursor(["10"])}`],
    ["TC-NOUS66_DEV-49", "cursor の world_time_sec が整数でない", `cursor=${encodeCursor(["abc", postIdOf(1)])}`],
  ])("%s GET /admin/api/posts は %s のとき 400 VALIDATION_ERROR を返す", async (_id, _label, query) => {
    seedPost(t.db, { worldId, agentId, postId: postIdOf(1) });

    const res = await getJson(`/admin/api/posts?${query}`);

    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(Object.keys(body.error.fields).length).toBeGreaterThan(0);
  });

  it("TC-NOUS66_DEV-50 POST /admin/api/posts/:postId/hide は 200 { postId, visibility: 'hidden' } を返し、visibility・hide_records・admin_audit_logs を記録する", async () => {
    const { postId } = seedPost(t.db, { worldId, agentId, postId: postIdOf(1) });

    const res = await postJson(`/admin/api/posts/${postId}/hide`, JSON.stringify({ reason: "不適切な内容" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ postId, visibility: "hidden" });
    expect(visibilityOf(postId)).toBe("hidden");
    expect(hideRows()).toHaveLength(1);
    expect(hideRows()[0]).toMatchObject({
      post_id: postId,
      operation: "hide",
      reason: "不適切な内容",
      operated_at: TEST_NOW.toISOString(),
    });
    const audits = auditRows();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      admin_id: TEST_ADMIN_ID,
      operation: "post.hide",
      target_type: "post",
      target_id: postId,
      world_id: worldId,
    });
    expect(JSON.parse(audits[0]?.before_json ?? "null")).toEqual({ visibility: "public" });
    expect(JSON.parse(audits[0]?.after_json ?? "null")).toEqual({ visibility: "hidden", reason: "不適切な内容" });
  });

  it.each([
    ["TC-NOUS66_DEV-51", "本文がない", undefined],
    ["TC-NOUS66_DEV-52", "本文が壊れた JSON", "{ reason: "],
    ["TC-NOUS66_DEV-53", "本文が空のオブジェクト", "{}"],
  ])(
    "%s POST hide は %s でも reason 未指定として 200 になり、reason は空文字で記録される",
    async (_id, _label, body) => {
      const { postId } = seedPost(t.db, { worldId, agentId, postId: postIdOf(1) });

      const res = await postJson(`/admin/api/posts/${postId}/hide`, body);

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ postId, visibility: "hidden" });
      expect(hideRows()[0]?.reason).toBe("");
    },
  );

  it("TC-NOUS66_DEV-54 POST hide は存在しない投稿・別の世界の投稿に 404 POST_NOT_FOUND を返し、何も記録しない", async () => {
    const other = seedOtherWorldPost(postIdOf(9));

    const missing = await postJson(`/admin/api/posts/${postIdOf(99)}/hide`, "{}");
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({
      error: { code: "POST_NOT_FOUND", message: "この投稿は見つかりません", fields: {} },
    });

    const otherWorld = await postJson(`/admin/api/posts/${other.postId}/hide`, "{}");
    expect(otherWorld.status).toBe(404);
    expect(((await otherWorld.json()) as ErrorBody).error.code).toBe("POST_NOT_FOUND");

    expect(visibilityOf(other.postId)).toBe("public");
    expect(hideRows()).toHaveLength(0);
    expect(auditRows()).toHaveLength(0);
  });

  it("TC-NOUS66_DEV-55 POST hide はすでに非表示の投稿に 409 ALREADY_HIDDEN を返し、記録を増やさない", async () => {
    const { postId } = seedPost(t.db, { worldId, agentId, postId: postIdOf(1), visibility: "hidden" });

    const res = await postJson(`/admin/api/posts/${postId}/hide`, "{}");

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: { code: "ALREADY_HIDDEN", message: "この投稿はすでに非表示です", fields: {} },
    });
    expect(hideRows()).toHaveLength(0);
    expect(auditRows()).toHaveLength(0);
  });

  it("TC-NOUS66_DEV-56 POST hide は reason が 201 字で 400 VALIDATION_ERROR（fields.reason）になり何も変えず、200 字なら 200 になる", async () => {
    const { postId } = seedPost(t.db, { worldId, agentId, postId: postIdOf(1) });
    const second = seedPost(t.db, { worldId, agentId, postId: postIdOf(2) });

    const tooLong = await postJson(`/admin/api/posts/${postId}/hide`, JSON.stringify({ reason: "あ".repeat(201) }));
    expect(tooLong.status).toBe(400);
    const body = (await tooLong.json()) as ErrorBody;
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.fields).toHaveProperty("reason");
    expect(visibilityOf(postId)).toBe("public");
    expect(hideRows()).toHaveLength(0);
    expect(auditRows()).toHaveLength(0);

    const justRight = await postJson(
      `/admin/api/posts/${second.postId}/hide`,
      JSON.stringify({ reason: "あ".repeat(200) }),
    );
    expect(justRight.status).toBe(200);
    expect(hideRows()[0]?.reason).toHaveLength(200);
  });

  it("TC-NOUS66_DEV-57 POST hide・unhide は postId が 26 字でないと 400 VALIDATION_ERROR を返す", async () => {
    const hide = await postJson("/admin/api/posts/short/hide", "{}");
    expect(hide.status).toBe(400);
    expect(((await hide.json()) as ErrorBody).error.code).toBe("VALIDATION_ERROR");

    const unhide = await postJson("/admin/api/posts/short/unhide", "{}");
    expect(unhide.status).toBe(400);
    expect(((await unhide.json()) as ErrorBody).error.code).toBe("VALIDATION_ERROR");
  });

  it("TC-NOUS66_DEV-58 POST /admin/api/posts/:postId/unhide は 200 { postId, visibility: 'public' } を返し、visibility・hide_records・admin_audit_logs を記録する", async () => {
    const { postId } = seedPost(t.db, { worldId, agentId, postId: postIdOf(1), visibility: "hidden" });

    const res = await postJson(`/admin/api/posts/${postId}/unhide`, JSON.stringify({ reason: "誤って非表示にした" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ postId, visibility: "public" });
    expect(visibilityOf(postId)).toBe("public");
    expect(hideRows()).toHaveLength(1);
    expect(hideRows()[0]).toMatchObject({ post_id: postId, operation: "unhide", reason: "誤って非表示にした" });
    const audits = auditRows();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      admin_id: TEST_ADMIN_ID,
      operation: "post.unhide",
      target_type: "post",
      target_id: postId,
      world_id: worldId,
    });
    expect(JSON.parse(audits[0]?.after_json ?? "null")).toEqual({ visibility: "public", reason: "誤って非表示にした" });
  });

  it("TC-NOUS66_DEV-59 POST unhide は本文なしでも 200 になり、public の投稿に 409 NOT_HIDDEN、存在しない投稿・別の世界の投稿に 404 POST_NOT_FOUND を返す", async () => {
    const hidden = seedPost(t.db, { worldId, agentId, postId: postIdOf(1), visibility: "hidden" });
    const publicPost = seedPost(t.db, { worldId, agentId, postId: postIdOf(2) });
    const other = seedOtherWorldPost(postIdOf(9), "hidden");

    const notHidden = await postJson(`/admin/api/posts/${publicPost.postId}/unhide`, "{}");
    expect(notHidden.status).toBe(409);
    expect(await notHidden.json()).toEqual({
      error: { code: "NOT_HIDDEN", message: "この投稿は非表示ではありません", fields: {} },
    });

    const missing = await postJson(`/admin/api/posts/${postIdOf(99)}/unhide`, "{}");
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as ErrorBody).error.code).toBe("POST_NOT_FOUND");

    const otherWorld = await postJson(`/admin/api/posts/${other.postId}/unhide`, "{}");
    expect(otherWorld.status).toBe(404);
    expect(visibilityOf(other.postId)).toBe("hidden");
    expect(hideRows()).toHaveLength(0);

    const ok = await postJson(`/admin/api/posts/${hidden.postId}/unhide`);
    expect(ok.status).toBe(200);
    expect(hideRows()[0]?.reason).toBe("");
  });

  it("TC-NOUS66_DEV-60 POST unhide は reason が 201 字で 400 VALIDATION_ERROR になり、投稿・hide_records・監査を変えない", async () => {
    const { postId } = seedPost(t.db, { worldId, agentId, postId: postIdOf(1), visibility: "hidden" });

    const res = await postJson(`/admin/api/posts/${postId}/unhide`, JSON.stringify({ reason: "あ".repeat(201) }));

    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.fields).toHaveProperty("reason");
    expect(visibilityOf(postId)).toBe("hidden");
    expect(hideRows()).toHaveLength(0);
    expect(auditRows()).toHaveLength(0);
  });

  it("TC-NOUS66_DEV-61 GET /admin/api/hide-records は hide・unhide の履歴を新しい順に 200 で返し、本文を 40 字に切り、limit と nextCursor でページ送りできる", async () => {
    const { postId } = seedPost(t.db, {
      worldId,
      agentId,
      postId: postIdOf(1),
      body: `${"あ".repeat(40)}切られる部分`,
    });

    await postJson(`/admin/api/posts/${postId}/hide`, JSON.stringify({ reason: "1回目" }));
    await clock.advance(1000);
    await postJson(`/admin/api/posts/${postId}/unhide`, JSON.stringify({ reason: "戻す" }));
    await clock.advance(1000);
    await postJson(`/admin/api/posts/${postId}/hide`, JSON.stringify({ reason: "2回目" }));

    const res = await getJson("/admin/api/hide-records");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: {
        hideId: string;
        postId: string;
        operation: string;
        reason: string;
        operatedAt: string;
        postBodyExcerpt: string;
      }[];
      nextCursor: string | null;
    };
    expect(body.nextCursor).toBeNull();
    expect(body.items.map((i) => [i.operation, i.reason])).toEqual([
      ["hide", "2回目"],
      ["unhide", "戻す"],
      ["hide", "1回目"],
    ]);
    expect(body.items[0]).toMatchObject({
      postId,
      operatedAt: new Date(TEST_NOW.getTime() + 2000).toISOString(),
      postBodyExcerpt: "あ".repeat(40),
    });
    expect(body.items[0]?.hideId).toHaveLength(26);

    const collected: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page = await getJson(`/admin/api/hide-records?limit=2${cursor ? `&cursor=${cursor}` : ""}`);
      expect(page.status).toBe(200);
      const pageBody = (await page.json()) as { items: { hideId: string }[]; nextCursor: string | null };
      collected.push(...pageBody.items.map((i) => i.hideId));
      cursor = pageBody.nextCursor;
      pages += 1;
      expect(pages).toBeLessThanOrEqual(2);
    } while (cursor !== null);
    expect(pages).toBe(2);
    expect(collected).toEqual(body.items.map((i) => i.hideId));
  });

  it("TC-NOUS66_DEV-62 GET /admin/api/hide-records は別の世界（archived）の投稿の履歴を含めず、履歴がなければ空を返す", async () => {
    expect(await (await getJson("/admin/api/hide-records")).json()).toEqual({ items: [], nextCursor: null });

    const current = seedPost(t.db, { worldId, agentId, postId: postIdOf(1), body: "いまの世界" });
    const old = seedOtherWorldPost(postIdOf(9));
    t.db
      .insert(hide_records)
      .values([
        {
          hide_id: "01HIDE00000000000000000001",
          post_id: current.postId,
          operation: "hide",
          reason: "",
          operated_at: "2026-10-22T09:00:00.000Z",
        },
        {
          hide_id: "01HIDE00000000000000000002",
          post_id: old.postId,
          operation: "hide",
          reason: "",
          operated_at: "2026-10-22T09:30:00.000Z",
        },
      ])
      .run();

    const res = await getJson("/admin/api/hide-records");

    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { postId: string }[] };
    expect(body.items.map((i) => i.postId)).toEqual([current.postId]);
  });

  it.each([
    ["TC-NOUS66_DEV-63", "limit が 0", "limit=0"],
    ["TC-NOUS66_DEV-64", "limit が 101", "limit=101"],
    ["TC-NOUS66_DEV-65", "cursor が Base64URL でない", "cursor=!!!"],
    ["TC-NOUS66_DEV-66", "cursor が 2 要素でない", `cursor=${encodeCursor(["2026-10-22T09:00:00.000Z"])}`],
    [
      "TC-NOUS66_DEV-67",
      "cursor の operated_at が日時でない",
      `cursor=${encodeCursor(["abc", "01HIDE00000000000000000001"])}`,
    ],
  ])("%s GET /admin/api/hide-records は %s のとき 400 VALIDATION_ERROR を返す", async (_id, _label, query) => {
    const res = await getJson(`/admin/api/hide-records?${query}`);

    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(Object.keys(body.error.fields).length).toBeGreaterThan(0);
  });

  it("TC-NOUS66_DEV-68 X-CSRF-Token のない hide・unhide の POST は 403 CSRF_INVALID になり、投稿・hide_records・監査を変えない", async () => {
    const publicPost = seedPost(t.db, { worldId, agentId, postId: postIdOf(1) });
    const hiddenPost = seedPost(t.db, { worldId, agentId, postId: postIdOf(2), visibility: "hidden" });
    const noCsrf = (path: string) =>
      app().request(path, {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

    for (const path of [`/admin/api/posts/${publicPost.postId}/hide`, `/admin/api/posts/${hiddenPost.postId}/unhide`]) {
      const res = await noCsrf(path);
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({
        error: {
          code: "CSRF_INVALID",
          message: "画面を再読み込みしてから、もう一度操作してください",
          fields: {},
        },
      });
    }
    expect(visibilityOf(publicPost.postId)).toBe("public");
    expect(visibilityOf(hiddenPost.postId)).toBe("hidden");
    expect(hideRows()).toHaveLength(0);
    expect(auditRows()).toHaveLength(0);
  });
});
