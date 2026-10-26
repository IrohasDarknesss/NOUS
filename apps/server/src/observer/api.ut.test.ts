// 単体テスト（NOUS-105）。観点表は docs/test/unit/NOUS-105/観点表_api.json
import type { HttpBindings } from "@hono/node-server";
import {
  VIEW_COOKIE_NAME,
  type AgentPostsResponse,
  type FollowsResponse,
  type ThreadNode,
  type ThreadView,
  type TimelineResponse,
  type WorldView,
} from "@nous/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedAgent, seedEvent } from "../../test/helpers/generationSeed";
import { createTestDb, type TestDb } from "../../test/helpers/testDb";
import { FakeClock } from "../clock/fakeClock";
import { follows, invitations, posts, worlds } from "../db/schema";
import { encodeCursor } from "../lib/cursor";
import type { ErrorBody } from "../lib/errors";
import { newUlid } from "../lib/ids";
import { createLogger } from "../lib/logger";
import { randomToken, sha256Hex } from "../lib/tokens";
import { createObserverApp } from "./observerServer";

const START = "2026-10-21T09:00:00.000Z";
const LAN = "192.168.1.20";

const from = () => ({ incoming: { socket: { remoteAddress: LAN } } }) as unknown as HttpBindings;
/** 番号から 26 字の ID を作る（辞書順を固定したいとき用） */
const idAt = (prefix: string, n: number): string => `01JB0000000000000000${prefix}${String(n).padStart(4, "0")}`;

type WorldState = "preparing" | "running" | "paused" | "limit_stopped" | "emergency_stopped" | "archived";

describe("observer API（単体テスト）", () => {
  let t: TestDb;
  let app: ReturnType<typeof createObserverApp>;
  let cookie: string;
  let worldId: string;
  let minato: string;
  let cycle = 1;

  const insertWorld = (state: WorldState, elapsed = 1000): string => {
    const id = newUlid();
    t.db
      .insert(worlds)
      .values({
        world_id: id,
        name: "テストの世界",
        state,
        world_elapsed_sec: elapsed,
        running_since: state === "running" ? START : null,
        archived_at: state === "archived" ? START : null,
        created_at: START,
      })
      .run();
    return id;
  };
  const insertPost = (
    world: string,
    agentId: string,
    opts: {
      postId?: string;
      body?: string;
      sec?: number;
      replyTo?: string;
      root?: string;
      depth?: number;
      hidden?: boolean;
    } = {},
  ): string => {
    const postId = opts.postId ?? newUlid();
    const sec = opts.sec ?? 100;
    t.db
      .insert(posts)
      .values({
        post_id: postId,
        world_id: world,
        agent_id: agentId,
        body: opts.body ?? `投稿 ${postId}`,
        reply_to_post_id: opts.replyTo ?? null,
        root_post_id: opts.replyTo ? (opts.root ?? opts.replyTo) : postId,
        depth: opts.replyTo ? (opts.depth ?? 1) : 0,
        visibility: opts.hidden ? "hidden" : "public",
        world_time_sec: sec,
        created_at: START,
        generation_event_id: seedEvent(t.db, world, agentId, cycle++, sec),
      })
      .run();
    return postId;
  };
  /** 起点から 1 本の返信の鎖を作る（段数 0〜n−1） */
  const insertChain = (n: number): string[] => {
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const prev = ids[i - 1];
      ids.push(
        prev === undefined
          ? insertPost(worldId, minato, { sec: 100 })
          : insertPost(worldId, minato, { sec: 100 + i, replyTo: prev, root: ids[0], depth: i }),
      );
    }
    return ids;
  };
  const insertFollow = (followerId: string, followeeId: string, startedSec = 100): void => {
    t.db
      .insert(follows)
      .values({
        follow_id: newUlid(),
        world_id: worldId,
        follower_id: followerId,
        followee_id: followeeId,
        started_world_sec: startedSec,
        start_event_id: seedEvent(t.db, worldId, followerId, cycle++, startedSec),
      })
      .run();
  };
  const getApi = (path: string) => app.request(path, { headers: { Cookie: cookie } }, from());
  const errorOf = async (res: Response) => ((await res.json()) as ErrorBody).error;
  /** 鎖の木を末端までたどり、深さごとの節を返す */
  const walk = (node: ThreadNode): ThreadNode[] => [node, ...(node.children[0] ? walk(node.children[0]) : [])];

  beforeEach(() => {
    t = createTestDb();
    app = createObserverApp(
      { db: t.db, clock: new FakeClock(new Date(START)), logger: createLogger({ sinks: [] }) },
      { staticDir: null },
    );
    const token = randomToken();
    t.db
      .insert(invitations)
      .values({ invitation_id: newUlid(), label: "招待", token_hash: sha256Hex(token), issued_at: START })
      .run();
    cookie = `${VIEW_COOKIE_NAME}=${token}`;
    cycle = 1;
  });
  afterEach(() => {
    t.cleanup();
  });

  describe("GET /api/world", () => {
    it.each<WorldState>(["preparing", "limit_stopped", "emergency_stopped"])(
      "TC-UT_OBS-023 running・paused 以外の state もそのまま返し、isRunning は false（%j）",
      async (state) => {
        insertWorld(state, 777);

        const res = await getApi("/api/world");

        expect(res.status).toBe(200);
        expect((await res.json()) as WorldView).toMatchObject({ state, worldTimeSec: 777, isRunning: false });
      },
    );

    it("TC-UT_OBS-024 アーカイブ済みの世界しかなければ 404 WORLD_NOT_FOUND", async () => {
      insertWorld("archived");

      const res = await getApi("/api/world");

      expect(res.status).toBe(404);
      expect((await errorOf(res)).code).toBe("WORLD_NOT_FOUND");
    });
  });

  describe("GET /api/timeline", () => {
    beforeEach(() => {
      worldId = insertWorld("running");
      minato = seedAgent(t.db, worldId, "minato");
    });
    const seedPosts = (n: number) =>
      Array.from({ length: n }, (_, i) => insertPost(worldId, minato, { postId: idAt("TL", i), sec: 100 + i }));
    const timeline = async (query: string) =>
      (await (await getApi(`/api/timeline${query}`)).json()) as TimelineResponse;

    it("TC-UT_OBS-025 limit=1 は 1 件と nextCursor を返す", async () => {
      const ids = seedPosts(2);

      const page = await timeline("?limit=1");

      expect(page.items.map((i) => i.postId)).toEqual([ids[1]]);
      expect(page.nextCursor).not.toBeNull();
    });

    it("TC-UT_OBS-026 limit=50 で 51 件あれば 50 件と nextCursor を返す", async () => {
      seedPosts(51);

      const page = await timeline("?limit=50");

      expect(page.items).toHaveLength(50);
      expect(page.nextCursor).not.toBeNull();
    });

    it("TC-UT_OBS-027 limit を省略すると 30 件ずつ返す", async () => {
      seedPosts(31);

      const page = await timeline("");

      expect(page.items).toHaveLength(30);
      expect(page.nextCursor).not.toBeNull();
    });

    it("TC-UT_OBS-028 投稿がちょうど limit 件なら nextCursor は null", async () => {
      seedPosts(3);

      const page = await timeline("?limit=3");

      expect(page.items).toHaveLength(3);
      expect(page.nextCursor).toBeNull();
    });

    it.each(["limit=1.5", "limit="])(
      "TC-UT_OBS-029 limit が整数でない・空なら 400（fields.limit）（%j）",
      async (query) => {
        const res = await getApi(`/api/timeline?${query}`);

        expect(res.status).toBe(400);
        expect((await errorOf(res)).fields.limit).toBeTruthy();
      },
    );

    it.each(["abc+def", "A".repeat(201)])(
      "TC-UT_OBS-030 cursor が Base64URL の字でない・201 字なら 400（fields.cursor）（%j）",
      async (cursor) => {
        const res = await getApi(`/api/timeline?cursor=${encodeURIComponent(cursor)}`);

        expect(res.status).toBe(400);
        expect((await errorOf(res)).fields.cursor).toBeTruthy();
      },
    );

    it("TC-UT_OBS-031 cursor の秒が安全な整数を超えれば 400（fields.cursor）", async () => {
      const cursor = encodeCursor(["9007199254740993", idAt("TL", 1)]);

      const res = await getApi(`/api/timeline?cursor=${cursor}`);

      expect(res.status).toBe(400);
      expect((await errorOf(res)).fields.cursor).toBeTruthy();
    });

    it("TC-UT_OBS-032 cursor の秒が 0 なら、それより古い投稿がないので空と nextCursor null", async () => {
      seedPosts(2);

      const page = await timeline(`?cursor=${encodeCursor(["0", idAt("TL", 0)])}`);

      expect(page.items).toEqual([]);
      expect(page.nextCursor).toBeNull();
    });

    it("TC-UT_OBS-033 since の投稿が非表示でも、それより新しい public の投稿を返す", async () => {
      const hidden = insertPost(worldId, minato, { postId: idAt("SN", 1), sec: 100, hidden: true });
      const newer = insertPost(worldId, minato, { postId: idAt("SN", 2), sec: 200 });

      const page = await timeline(`?since=${hidden}`);

      expect(page.items.map((i) => i.postId)).toEqual([newer]);
    });

    it("TC-UT_OBS-034 since が別の世界（アーカイブ済み）の投稿なら空を返す", async () => {
      const oldWorld = insertWorld("archived");
      const oldPost = insertPost(oldWorld, seedAgent(t.db, oldWorld, "oldone"), { sec: 10 });
      seedPosts(2);

      const page = await timeline(`?since=${oldPost}`);

      expect(page.items).toEqual([]);
      expect(page.nextCursor).toBeNull();
    });

    it("TC-UT_OBS-035 停止中のエージェントの投稿も返し、agent に state: stopped と isAi: true が付く", async () => {
      const sleepy = seedAgent(t.db, worldId, "sleepy", { state: "stopped" });
      insertPost(worldId, sleepy, { sec: 100 });

      const page = await timeline("");

      expect(page.items[0]?.agent).toMatchObject({ handle: "sleepy", state: "stopped", isAi: true });
    });

    it("TC-UT_OBS-036 本文は HTML に変換せず、そのままの文字列で返す", async () => {
      const body = '<script>alert("x")</script> & <b>太字</b>';
      insertPost(worldId, minato, { body });

      const page = await timeline("");

      expect(page.items[0]?.body).toBe(body);
    });
  });

  describe("GET /api/posts/:postId/thread", () => {
    beforeEach(() => {
      worldId = insertWorld("running");
      minato = seedAgent(t.db, worldId, "minato");
    });
    const thread = async (path: string) => (await (await getApi(path)).json()) as ThreadView;

    it("TC-UT_OBS-037 depth=0 は 400（fields.depth）", async () => {
      const [root] = insertChain(1);

      const res = await getApi(`/api/posts/${root}/thread?depth=0`);

      expect(res.status).toBe(400);
      expect((await errorOf(res)).fields.depth).toBeTruthy();
    });

    it("TC-UT_OBS-038 depth=10 は段数 10 まで返し、段数 10 の節の moreCount に残りの子孫の数を入れる", async () => {
      const ids = insertChain(12);

      const view = await thread(`/api/posts/${ids[0]}/thread?depth=10`);

      const nodes = walk(view.root);
      expect(nodes).toHaveLength(11);
      expect(nodes[10]).toMatchObject({ postId: ids[10], children: [], moreCount: 1 });
    });

    it("TC-UT_OBS-039 depth を省略すると 5 段まで返す", async () => {
      const ids = insertChain(7);

      const view = await thread(`/api/posts/${ids[0]}/thread`);

      const nodes = walk(view.root);
      expect(nodes).toHaveLength(6);
      expect(nodes[5]).toMatchObject({ postId: ids[5], moreCount: 1 });
    });

    it("TC-UT_OBS-040 起点が非表示なら起点の body・agent を null にし、子は残す", async () => {
      const root = insertPost(worldId, minato, { body: "伏せられる起点", hidden: true });
      const child = insertPost(worldId, minato, { replyTo: root, sec: 200 });

      const view = await thread(`/api/posts/${child}/thread`);

      expect(view.root).toMatchObject({ postId: root, hidden: true, body: null, agent: null });
      expect(view.root.children.map((c) => c.postId)).toEqual([child]);
      expect(JSON.stringify(view)).not.toContain("伏せられる起点");
    });

    it("TC-UT_OBS-041 アーカイブ済みの世界の投稿は 404 POST_NOT_FOUND", async () => {
      const oldWorld = insertWorld("archived");
      const oldPost = insertPost(oldWorld, seedAgent(t.db, oldWorld, "oldone"));

      const res = await getApi(`/api/posts/${oldPost}/thread`);

      expect(res.status).toBe(404);
      expect((await errorOf(res)).code).toBe("POST_NOT_FOUND");
    });

    it("TC-UT_OBS-042 子は world_time_sec の昇順、同じ秒なら post_id の昇順に並べる", async () => {
      const root = insertPost(worldId, minato, { postId: idAt("RT", 1), sec: 100 });
      const late = insertPost(worldId, minato, { postId: idAt("CH", 1), replyTo: root, sec: 300 });
      const b = insertPost(worldId, minato, { postId: idAt("CH", 3), replyTo: root, sec: 200 });
      const a = insertPost(worldId, minato, { postId: idAt("CH", 2), replyTo: root, sec: 200 });

      const view = await thread(`/api/posts/${root}/thread`);

      expect(view.root.children.map((c) => c.postId)).toEqual([a, b, late]);
    });

    it("TC-UT_OBS-043 from に非表示の投稿を指定すると、伏せた形の節を起点にした部分木を返す", async () => {
      const root = insertPost(worldId, minato, { sec: 100 });
      const hidden = insertPost(worldId, minato, { replyTo: root, sec: 200, hidden: true });
      const grandChild = insertPost(worldId, minato, { replyTo: hidden, root, depth: 2, sec: 300 });

      const view = await thread(`/api/posts/${root}/thread?from=${hidden}`);

      expect(view.root).toMatchObject({ postId: hidden, hidden: true, body: null, agent: null });
      expect(view.root.children.map((c) => c.postId)).toEqual([grandChild]);
    });
  });

  describe("GET /api/agents/:agentId・/posts・/follows", () => {
    beforeEach(() => {
      worldId = insertWorld("running");
      minato = seedAgent(t.db, worldId, "minato");
    });

    it("TC-UT_OBS-044 アーカイブ済みの世界のエージェントは 404 AGENT_NOT_FOUND", async () => {
      const oldWorld = insertWorld("archived");
      const oldAgent = seedAgent(t.db, oldWorld, "oldone");

      const res = await getApi(`/api/agents/${oldAgent}`);

      expect(res.status).toBe(404);
      expect((await errorOf(res)).code).toBe("AGENT_NOT_FOUND");
    });

    it("TC-UT_OBS-045 agentId が 25 字なら 400（fields.agentId）", async () => {
      const res = await getApi(`/api/agents/${minato.slice(0, 25)}`);

      expect(res.status).toBe(400);
      expect((await errorOf(res)).fields.agentId).toBeTruthy();
    });

    it("TC-UT_OBS-046 過去投稿では since を渡しても無視し、cursor と limit で返す", async () => {
      const old = insertPost(worldId, minato, { postId: idAt("AP", 1), sec: 100 });
      const mid = insertPost(worldId, minato, { postId: idAt("AP", 2), sec: 200 });
      insertPost(worldId, minato, { postId: idAt("AP", 3), sec: 300 });

      const res = await getApi(`/api/agents/${minato}/posts?limit=2&since=${mid}`);

      const page = (await res.json()) as AgentPostsResponse;
      expect(res.status).toBe(200);
      expect(page.items.map((i) => i.postId)).toEqual([idAt("AP", 3), mid]);
      expect(page.items.map((i) => i.postId)).not.toContain(old);
      expect(page.nextCursor).not.toBeNull();
    });

    it("TC-UT_OBS-047 過去投稿がちょうど limit 件なら nextCursor は null", async () => {
      insertPost(worldId, minato, { sec: 100 });
      insertPost(worldId, minato, { sec: 200 });

      const page = (await (await getApi(`/api/agents/${minato}/posts?limit=2`)).json()) as AgentPostsResponse;

      expect(page.items).toHaveLength(2);
      expect(page.nextCursor).toBeNull();
    });

    it("TC-UT_OBS-048 follows の type を省略すると 400（fields.type）", async () => {
      const res = await getApi(`/api/agents/${minato}/follows`);

      expect(res.status).toBe(400);
      expect((await errorOf(res)).fields.type).toBeTruthy();
    });

    it("TC-UT_OBS-049 フォローが 0 件なら items は空の配列", async () => {
      const res = await getApi(`/api/agents/${minato}/follows?type=following`);

      expect(res.status).toBe(200);
      expect((await res.json()) as FollowsResponse).toEqual({ items: [] });
    });

    it("TC-UT_OBS-050 停止中の相手も一覧に出し、state: stopped と isAi: true が付く", async () => {
      const sleepy = seedAgent(t.db, worldId, "sleepy", { state: "stopped" });
      insertFollow(minato, sleepy);

      const res = await getApi(`/api/agents/${minato}/follows?type=following`);

      const body = (await res.json()) as FollowsResponse;
      expect(body.items).toEqual([expect.objectContaining({ handle: "sleepy", state: "stopped", isAi: true })]);
    });
  });
});
