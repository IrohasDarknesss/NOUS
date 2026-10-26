// 単体テスト（NOUS-105）。観点表は docs/test/unit/NOUS-105/観点表_observer.json
import type { HttpBindings } from "@hono/node-server";
import { VIEW_COOKIE_NAME } from "@nous/shared";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedRunningWorld } from "../../test/helpers/generationSeed";
import { createTestDb, type TestDb } from "../../test/helpers/testDb";
import { FakeClock } from "../clock/fakeClock";
import { invitations, view_access_logs } from "../db/schema";
import { newUlid } from "../lib/ids";
import { createLogger } from "../lib/logger";
import { randomToken, sha256Hex } from "../lib/tokens";
import { maskPath } from "./context";
import { isPrivateIPv4, normalizeRemoteAddress } from "./middleware/privateNetworkOnly";
import { SECURITY_HEADERS } from "./middleware/securityHeaders";
import { createObserverApp } from "./observerServer";
import { acceptInvite } from "./services/inviteService";

const START = "2026-10-21T09:00:00.000Z";
const LAN = "192.168.1.20";

/** app.request に渡す env（送信元のアドレス） */
const from = (remoteAddress: string) => ({ incoming: { socket: { remoteAddress } } }) as unknown as HttpBindings;

const errorCode = async (res: Response): Promise<string> =>
  ((await res.json()) as { error: { code: string } }).error.code;

describe("observer 共通・招待（単体テスト）", () => {
  describe("isPrivateIPv4・normalizeRemoteAddress・maskPath", () => {
    it.each(["10.0.0.0", "172.16.0.0", "192.168.255.255", "127.255.255.255"])(
      "TC-UT_OBS-001 私設アドレスの範囲の端は true（%j）",
      (addr) => {
        expect(isPrivateIPv4(addr)).toBe(true);
      },
    );

    it.each(["9.255.255.255", "11.0.0.0", "126.255.255.255", "128.0.0.1", "192.167.255.255"])(
      "TC-UT_OBS-002 私設アドレスの範囲のすぐ外は false（%j）",
      (addr) => {
        expect(isPrivateIPv4(addr)).toBe(false);
      },
    );

    it("TC-UT_OBS-003 オクテットは 255 までが有効で、256 は false（最後のオクテット）", () => {
      expect(isPrivateIPv4("10.255.255.255")).toBe(true);
      expect(isPrivateIPv4("10.255.255.256")).toBe(false);
    });

    it.each(["10.0.0.1000", "10.0.0.1.", " 10.0.0.1", "10.0.0.1 ", "10.0.0.x"])(
      "TC-UT_OBS-004 IPv4 の形でないもの（4 桁・末尾のドット・前後の空白・英字）は false（%j）",
      (addr) => {
        expect(isPrivateIPv4(addr)).toBe(false);
      },
    );

    it.each(["169.254.1.1", "100.64.0.1", "0.0.0.0"])(
      "TC-UT_OBS-005 設計の 4 つの範囲にないリンクローカル・CGNAT・0.0.0.0 は false（%j）",
      (addr) => {
        expect(isPrivateIPv4(addr)).toBe(false);
      },
    );

    it("TC-UT_OBS-006 normalizeRemoteAddress は大文字の ::FFFF: も外す", () => {
      expect(normalizeRemoteAddress("::FFFF:10.0.0.5")).toBe("10.0.0.5");
    });

    it("TC-UT_OBS-007 maskPath は /invite/ の後ろだけを伏せ、他のパスはそのまま", () => {
      expect(maskPath("/invite/abc")).toBe("/invite/***");
      expect(maskPath("/api/world")).toBe("/api/world");
      expect(maskPath("/invitex")).toBe("/invitex");
    });
  });

  describe("観察サーバーのミドルウェアと招待", () => {
    let t: TestDb;
    let clock: FakeClock;
    let logs: string[];
    let app: ReturnType<typeof createObserverApp>;

    const issue = (opts: { revoked?: boolean } = {}) => {
      const token = randomToken();
      const invitationId = newUlid();
      t.db
        .insert(invitations)
        .values({
          invitation_id: invitationId,
          label: "友人",
          token_hash: sha256Hex(token),
          issued_at: START,
          revoked_at: opts.revoked ? START : null,
        })
        .run();
      return { token, invitationId };
    };
    const viewLogs = () => t.db.select().from(view_access_logs).all();
    const invitation = (id: string) => t.db.select().from(invitations).where(eq(invitations.invitation_id, id)).get();
    const withCookie = (token: string, init: RequestInit = {}) => ({
      ...init,
      headers: { Cookie: `${VIEW_COOKIE_NAME}=${token}` },
    });

    beforeEach(() => {
      t = createTestDb();
      clock = new FakeClock(new Date(START));
      logs = [];
      const logger = createLogger({ level: "debug", sinks: [(line) => logs.push(line)] });
      app = createObserverApp({ db: t.db, clock, logger }, { staticDir: null });
    });
    afterEach(() => {
      t.cleanup();
    });

    it("TC-UT_OBS-008 IPv6 のループバック（::1）からの要求は 403 FORBIDDEN_NETWORK", async () => {
      const res = await app.request("/api/world", {}, from("::1"));

      expect(res.status).toBe(403);
      expect(await errorCode(res)).toBe("FORBIDDEN_NETWORK");
    });

    it("TC-UT_OBS-009 X-Forwarded-For に私設アドレスがあっても、送信元が公開アドレスなら 403", async () => {
      const res = await app.request("/api/world", { headers: { "X-Forwarded-For": LAN } }, from("203.0.113.5"));

      expect(res.status).toBe(403);
    });

    it("TC-UT_OBS-010 IPv4 射影の公開アドレス（::ffff:8.8.8.8）は 403", async () => {
      const res = await app.request("/api/world", {}, from("::ffff:8.8.8.8"));

      expect(res.status).toBe(403);
    });

    it("TC-UT_OBS-011 公開アドレスからの POST は 405 ではなく 403（私設アドレスの検査が先）", async () => {
      const res = await app.request("/api/world", { method: "POST" }, from("203.0.113.5"));

      expect(res.status).toBe(403);
      expect(res.headers.get("Allow")).toBeNull();
    });

    it("TC-UT_OBS-012 POST /invite/:token は 405 で、招待の照合も記録もしない", async () => {
      const { token, invitationId } = issue();

      const res = await app.request(`/invite/${token}`, { method: "POST" }, from(LAN));

      expect(res.status).toBe(405);
      expect(res.headers.get("Set-Cookie")).toBeNull();
      expect(viewLogs()).toHaveLength(0);
      expect(invitation(invitationId)?.last_used_at).toBeNull();
    });

    it("TC-UT_OBS-013 OPTIONS も 405 WRITE_NOT_ALLOWED と Allow: GET, HEAD", async () => {
      const res = await app.request("/api/world", { method: "OPTIONS" }, from(LAN));

      expect(res.status).toBe(405);
      expect(await errorCode(res)).toBe("WRITE_NOT_ALLOWED");
      expect(res.headers.get("Allow")).toBe("GET, HEAD");
    });

    it("TC-UT_OBS-014 未知のパスの 404 にもセキュリティのヘッダーが付く", async () => {
      const res = await app.request("/unknown", {}, from(LAN));

      expect(res.status).toBe(404);
      for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
        expect(res.headers.get(name), name).toBe(value);
      }
    });

    it("TC-UT_OBS-015 401 VIEW_NOT_INVITED の応答にもセキュリティのヘッダーが付く", async () => {
      const res = await app.request("/api/world", {}, from(LAN));

      expect(res.status).toBe(401);
      for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
        expect(res.headers.get(name), name).toBe(value);
      }
    });

    it("TC-UT_OBS-016 同じ招待で 2 回受け付けると allowed が 2 行残り、last_used_at は 2 回目の時刻", async () => {
      const { token, invitationId } = issue();
      await app.request(`/invite/${token}`, {}, from(LAN));
      await clock.advance(60_000);

      const res = await app.request(`/invite/${token}`, {}, from(LAN));

      expect(res.headers.get("Location")).toBe("/");
      expect(viewLogs().map((l) => l.result)).toEqual(["allowed", "allowed"]);
      expect(invitation(invitationId)?.last_used_at).toBe("2026-10-21T09:01:00.000Z");
    });

    it("TC-UT_OBS-017 Cookie の値が招待トークンの形でなければ 401", async () => {
      const res = await app.request("/api/world", withCookie("short"), from(LAN));

      expect(res.status).toBe(401);
      expect(await errorCode(res)).toBe("VIEW_NOT_INVITED");
    });

    it("TC-UT_OBS-018 Cookie の値が空なら 401（Cookie なしと同じ扱い）", async () => {
      const res = await app.request("/api/world", withCookie(""), from(LAN));

      expect(res.status).toBe(401);
      expect(logs.some((l) => l.includes('"hasCookie":false'))).toBe(true);
    });

    it("TC-UT_OBS-019 有効な Cookie の API の閲覧では、閲覧の記録も last_used_at の更新もしない", async () => {
      seedRunningWorld(t.db);
      const { token, invitationId } = issue();

      const res = await app.request("/api/world", withCookie(token), from(LAN));

      expect(res.status).toBe(200);
      expect(viewLogs()).toHaveLength(0);
      expect(invitation(invitationId)?.last_used_at).toBeNull();
    });

    it("TC-UT_OBS-020 Cookie の発行の後に招待を失効させると、次の API の閲覧から 401", async () => {
      seedRunningWorld(t.db);
      const { token, invitationId } = issue();
      const before = await app.request("/api/world", withCookie(token), from(LAN));

      t.db.update(invitations).set({ revoked_at: START }).where(eq(invitations.invitation_id, invitationId)).run();
      const after = await app.request("/api/world", withCookie(token), from(LAN));

      expect(before.status).toBe(200);
      expect(after.status).toBe(401);
    });

    it("TC-UT_OBS-021 HEAD /api/world は 200 で本文を返さず、Cache-Control: no-store が付く", async () => {
      seedRunningWorld(t.db);
      const { token } = issue();

      const res = await app.request("/api/world", withCookie(token, { method: "HEAD" }), from(LAN));

      expect(res.status).toBe(200);
      expect(await res.text()).toBe("");
      expect(res.headers.get("Cache-Control")).toBe("no-store");
    });
  });

  describe("画面の静的ファイル", () => {
    it("TC-UT_OBS-051 画面のビルドの置き場所がなければ warn を残して配らず、/not-invited は 404", async () => {
      const t = createTestDb();
      const logs: string[] = [];
      const logger = createLogger({ sinks: [(line) => logs.push(line)] });

      const app = createObserverApp(
        { db: t.db, clock: new FakeClock(new Date(START)), logger },
        { staticDir: "/nonexistent/nous-observer-dist" },
      );
      const res = await app.request("/not-invited", {}, from(LAN));

      expect(res.status).toBe(404);
      expect(logs.some((l) => l.includes('"level":"warn"'))).toBe(true);
      t.cleanup();
    });
  });

  describe("acceptInvite", () => {
    let t: TestDb;
    beforeEach(() => {
      t = createTestDb();
    });
    afterEach(() => {
      t.cleanup();
    });

    it("TC-UT_OBS-022 有効な招待で allowed の記録に失敗したら、last_used_at の更新も取り消す", () => {
      const token = randomToken();
      const invitationId = newUlid();
      t.db
        .insert(invitations)
        .values({ invitation_id: invitationId, label: "a", token_hash: sha256Hex(token), issued_at: START })
        .run();
      t.db.$client.exec("DROP TABLE view_access_logs");

      expect(() => acceptInvite(t.db, token, "2026-10-21T10:00:00.000Z")).toThrow();

      const row = t.db.select().from(invitations).where(eq(invitations.invitation_id, invitationId)).get();
      expect(row?.last_used_at).toBeNull();
    });
  });
});
