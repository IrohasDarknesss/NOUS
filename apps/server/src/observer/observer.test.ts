import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HttpBindings } from "@hono/node-server";
import { VIEW_COOKIE_MAX_AGE_SEC, VIEW_COOKIE_NAME } from "@nous/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../test/helpers/testDb";
import { FakeClock } from "../clock/fakeClock";
import { invitations, view_access_logs } from "../db/schema";
import { newUlid } from "../lib/ids";
import { createLogger } from "../lib/logger";
import { randomToken, sha256Hex } from "../lib/tokens";
import { isPrivateIPv4, normalizeRemoteAddress } from "./middleware/privateNetworkOnly";
import { SECURITY_HEADERS } from "./middleware/securityHeaders";
import { createObserverApp } from "./observerServer";
import { acceptInvite, checkInvitation } from "./services/inviteService";

const START = "2026-10-21T09:00:00.000Z";
const LAN = "192.168.1.20";

/** app.request に渡す env（送信元のアドレス） */
const from = (remoteAddress: string) => ({ incoming: { socket: { remoteAddress } } }) as unknown as HttpBindings;

describe("isPrivateIPv4・normalizeRemoteAddress", () => {
  it("TC-NOUS55_DEV-01 私設 IPv4 と 127.0.0.0/8 は true", () => {
    for (const addr of ["10.0.0.1", "10.255.255.255", "172.16.0.1", "172.31.255.255", "192.168.0.1", "127.0.0.1"]) {
      expect(isPrivateIPv4(addr), addr).toBe(true);
    }
  });

  it("TC-NOUS55_DEV-02 公開のアドレス・範囲の境界の外・IPv6・不正な形は false", () => {
    for (const addr of [
      "172.15.255.255",
      "172.32.0.1",
      "192.169.0.1",
      "8.8.8.8",
      "256.1.1.1",
      "::1",
      "fe80::1",
      "",
      "192.168.1",
    ]) {
      expect(isPrivateIPv4(addr), addr).toBe(false);
    }
  });

  it("TC-NOUS55_DEV-03 '::ffff:' の接頭辞を外す", () => {
    expect(normalizeRemoteAddress("::ffff:192.168.1.5")).toBe("192.168.1.5");
    expect(normalizeRemoteAddress("192.168.1.5")).toBe("192.168.1.5");
  });
});

describe("観察サーバー", () => {
  let t: TestDb;
  let clock: FakeClock;
  let logs: string[];
  let app: ReturnType<typeof createObserverApp>;

  /** 招待を1件作り、トークンを返す */
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

  it("TC-NOUS55_DEV-04 私設アドレス以外からは 403 FORBIDDEN_NETWORK（ヘッダーも付く）", async () => {
    const res = await app.request("/api/world", {}, from("203.0.113.5"));
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("FORBIDDEN_NETWORK");
    expect(res.headers.get("Content-Security-Policy")).toBe(SECURITY_HEADERS["Content-Security-Policy"]);
    expect(logs.some((l) => l.includes('"level":"warn"') && l.includes("203.0.113.5"))).toBe(true);
  });

  it("TC-NOUS55_DEV-05 送信元が分からない要求も 403", async () => {
    const res = await app.request("/api/world");
    expect(res.status).toBe(403);
  });

  it("TC-NOUS55_DEV-06 IPv4 射影の IPv6（::ffff:192.168.x.x）は通す", async () => {
    const { token } = issue();
    const res = await app.request(`/invite/${token}`, {}, from(`::ffff:${LAN}`));
    expect(res.status).toBe(302);
  });

  it("TC-NOUS55_DEV-07 GET・HEAD 以外は 405 WRITE_NOT_ALLOWED と Allow: GET, HEAD", async () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const res = await app.request("/api/world", { method }, from(LAN));
      expect(res.status, method).toBe(405);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("WRITE_NOT_ALLOWED");
      expect(res.headers.get("Allow")).toBe("GET, HEAD");
      expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    }
  });

  it("TC-NOUS55_DEV-08 HEAD は 405 にしない", async () => {
    const { token } = issue();
    const res = await app.request(`/invite/${token}`, { method: "HEAD" }, from(LAN));
    expect(res.status).not.toBe(405);
  });

  it("TC-NOUS55_DEV-09 応答に CSP・nosniff・no-referrer が付く", async () => {
    const { token } = issue();
    const res = await app.request(`/invite/${token}`, {}, from(LAN));
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      expect(res.headers.get(name), name).toBe(value);
    }
  });

  it("TC-NOUS55_DEV-10 有効な招待は Cookie を発行して / へ。last_used_at と allowed の記録が残る", async () => {
    const { token, invitationId } = issue();
    await clock.advance(60_000);
    const res = await app.request(`/invite/${token}`, {}, from(LAN));
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/");
    const cookie = res.headers.get("Set-Cookie") ?? "";
    expect(cookie).toContain(`${VIEW_COOKIE_NAME}=${token}`);
    expect(cookie).toContain(`Max-Age=${VIEW_COOKIE_MAX_AGE_SEC}`);
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    const inv = t.db.select().from(invitations).get();
    expect(inv?.last_used_at).toBe(clock.nowIso());
    expect(viewLogs()).toMatchObject([{ invitation_id: invitationId, result: "allowed", accessed_at: clock.nowIso() }]);
  });

  it("TC-NOUS55_DEV-11 失効した招待は /not-invited へ。Cookie なし、denied に invitation_id を残す", async () => {
    const { token, invitationId } = issue({ revoked: true });
    const res = await app.request(`/invite/${token}`, {}, from(LAN));
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/not-invited");
    expect(res.headers.get("Set-Cookie")).toBeNull();
    expect(viewLogs()).toMatchObject([{ invitation_id: invitationId, result: "denied" }]);
    expect(t.db.select().from(invitations).get()?.last_used_at).toBeNull();
  });

  it("TC-NOUS55_DEV-12 存在しない招待は /not-invited へ。denied の invitation_id は NULL", async () => {
    const res = await app.request(`/invite/${randomToken()}`, {}, from(LAN));
    expect(res.headers.get("Location")).toBe("/not-invited");
    expect(viewLogs()).toMatchObject([{ invitation_id: null, result: "denied" }]);
  });

  it("TC-NOUS55_DEV-13 形の不正なトークンは照合せずに /not-invited へ", async () => {
    for (const bad of ["short", `${"A".repeat(42)}+`, "A".repeat(44)]) {
      const res = await app.request(`/invite/${bad}`, {}, from(LAN));
      expect(res.headers.get("Location"), bad).toBe("/not-invited");
    }
    expect(viewLogs().every((l) => l.result === "denied" && l.invitation_id === null)).toBe(true);
  });

  it("TC-NOUS55_DEV-14 失敗の理由（なし・失効・形）で応答を区別しない", async () => {
    const revoked = issue({ revoked: true });
    const a = await app.request(`/invite/${revoked.token}`, {}, from(LAN));
    const b = await app.request(`/invite/${randomToken()}`, {}, from(LAN));
    const c = await app.request("/invite/short", {}, from(LAN));
    for (const res of [a, b, c]) {
      expect(res.status).toBe(302);
      expect(res.headers.get("Location")).toBe("/not-invited");
      expect(await res.text()).toBe("");
    }
  });

  it("TC-NOUS55_DEV-15 Cookie のない /api/* は 401 VIEW_NOT_INVITED", async () => {
    const res = await app.request("/api/world", {}, from(LAN));
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("VIEW_NOT_INVITED");
  });

  it("TC-NOUS55_DEV-16 失効した招待の Cookie の /api/* は 401", async () => {
    const { token } = issue({ revoked: true });
    const res = await app.request("/api/world", { headers: { Cookie: `${VIEW_COOKIE_NAME}=${token}` } }, from(LAN));
    expect(res.status).toBe(401);
  });

  it("TC-NOUS55_DEV-17 有効な Cookie の /api/* は requireViewer を通る（API は NOUS-56 なので 404）", async () => {
    const { token } = issue();
    const res = await app.request("/api/world", { headers: { Cookie: `${VIEW_COOKIE_NAME}=${token}` } }, from(LAN));
    expect(res.status).toBe(404);
  });

  it("TC-NOUS55_DEV-18 招待トークンと Cookie の値をログに出さない", async () => {
    const valid = issue();
    const revoked = issue({ revoked: true });
    await app.request(`/invite/${valid.token}`, {}, from(LAN));
    await app.request(`/invite/${revoked.token}`, {}, from(LAN));
    await app.request(`/invite/${revoked.token}`, { method: "POST" }, from(LAN));
    await app.request("/api/world", { headers: { Cookie: `${VIEW_COOKIE_NAME}=${revoked.token}` } }, from(LAN));
    const all = logs.join("\n");
    expect(all).not.toContain(valid.token);
    expect(all).not.toContain(revoked.token);
  });

  it("TC-NOUS55_DEV-19 想定外の例外は 500 INTERNAL_ERROR（ヘッダー付き）", async () => {
    const { token } = issue();
    t.db.$client.close();
    const res = await app.request("/api/world", { headers: { Cookie: `${VIEW_COOKIE_NAME}=${token}` } }, from(LAN));
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("INTERNAL_ERROR");
    expect(res.headers.get("Content-Security-Policy")).not.toBeNull();
    expect(logs.some((l) => l.includes('"level":"error"'))).toBe(true);
  });
});

describe("inviteService", () => {
  let t: TestDb;
  beforeEach(() => {
    t = createTestDb();
  });
  afterEach(() => {
    t.cleanup();
  });

  it("TC-NOUS55_DEV-20 checkInvitation は有効なら招待を、失効・なし・形の不正なら null を返す", () => {
    const token = randomToken();
    t.db
      .insert(invitations)
      .values({
        invitation_id: "01JB0000000000000000000I01",
        label: "a",
        token_hash: sha256Hex(token),
        issued_at: START,
      })
      .run();
    expect(checkInvitation(t.db, token)?.invitation_id).toBe("01JB0000000000000000000I01");
    expect(checkInvitation(t.db, randomToken())).toBeNull();
    expect(checkInvitation(t.db, "short")).toBeNull();
    t.db.update(invitations).set({ revoked_at: START }).run();
    expect(checkInvitation(t.db, token)).toBeNull();
  });

  it("TC-NOUS55_DEV-21 acceptInvite は denied の記録に失敗しても ok: false を返す", () => {
    t.db.$client.exec("DROP TABLE view_access_logs");
    const lines: string[] = [];
    const logger = createLogger({ sinks: [(l) => lines.push(l)] });
    expect(acceptInvite(t.db, randomToken(), START, logger)).toEqual({ ok: false });
    expect(lines.some((l) => l.includes('"level":"error"'))).toBe(true);
  });
});

describe("画面の静的ファイル", () => {
  let t: TestDb;
  let dir: string;
  beforeEach(() => {
    t = createTestDb();
    dir = mkdtempSync(join(tmpdir(), "nous-observer-dist-"));
    writeFileSync(join(dir, "index.html"), "<!doctype html><title>NOUS</title>");
    writeFileSync(join(dir, "app.js"), "console.log(1);");
  });
  afterEach(() => {
    t.cleanup();
    rmSync(dir, { recursive: true, force: true });
  });

  const build = () =>
    createObserverApp(
      { db: t.db, clock: new FakeClock(new Date(START)), logger: createLogger({ sinks: [] }) },
      { staticDir: dir },
    );

  it("TC-NOUS55_DEV-22 静的ファイルと /not-invited は Cookie なしで返す（SPA の index.html）", async () => {
    const app = build();
    const js = await app.request("/app.js", {}, from(LAN));
    expect(js.status).toBe(200);
    expect(await js.text()).toContain("console.log");
    const page = await app.request("/not-invited", {}, from(LAN));
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("<title>NOUS</title>");
    expect(page.headers.get("Content-Security-Policy")).toBe(SECURITY_HEADERS["Content-Security-Policy"]);
  });

  it("TC-NOUS55_DEV-23 /api/* は index.html に落とさない", async () => {
    const app = build();
    const res = await app.request("/api/unknown", {}, from(LAN));
    expect(res.status).toBe(401);
  });
});
