import { describe, expect, it } from "vitest";
import { REDACTED, createLogger, isSecretKey, redactSecrets } from "./logger.js";

const fixedNow = () => new Date("2026-10-20T00:00:00.000Z");

function capture() {
  const lines: string[] = [];
  return { lines, sink: (line: string) => lines.push(line) };
}

describe("logger", () => {
  it("TC-NOUS44_DEV-16 redactSecrets が設計書の秘密のキーと Cookie を伏せる", () => {
    const out = redactSecrets({
      password: "p",
      token: "t",
      apiToken: "a",
      sessionId: "s",
      csrfToken: "c",
      authorization: "Bearer x",
      cookie: "aisns_admin=x",
      "set-cookie": "aisns_view=y",
      path: "/admin/api/login",
    });
    expect(out).toEqual({
      password: REDACTED,
      token: REDACTED,
      apiToken: REDACTED,
      sessionId: REDACTED,
      csrfToken: REDACTED,
      authorization: REDACTED,
      cookie: REDACTED,
      "set-cookie": REDACTED,
      path: "/admin/api/login",
    });
  });

  it("TC-NOUS44_DEV-17 大文字小文字・区切りの違いと、token・password で終わるキーも伏せる", () => {
    expect(isSecretKey("Authorization")).toBe(true);
    expect(isSecretKey("X-CSRF-Token")).toBe(true);
    expect(isSecretKey("CLOUDFLARE_API_TOKEN")).toBe(true);
    expect(isSecretKey("inviteToken")).toBe(true);
    expect(isSecretKey("newPassword")).toBe(true);
    expect(isSecretKey("invitationId")).toBe(false);
    expect(isSecretKey("tokens_used")).toBe(false);
  });

  it("TC-NOUS44_DEV-18 入れ子のオブジェクト・配列の中も伏せ、元の値は変えない", () => {
    const input = { headers: { cookie: "x" }, items: [{ password: "p", n: 1 }] };
    const out = redactSecrets(input);
    expect(out).toEqual({ headers: { cookie: REDACTED }, items: [{ password: REDACTED, n: 1 }] });
    expect(input.headers.cookie).toBe("x");
  });

  it("TC-NOUS44_DEV-19 循環する参照で止まらず、同じ値を2か所で指すだけなら両方出す", () => {
    const shared = { n: 1 };
    const loop: Record<string, unknown> = { a: shared, b: shared };
    loop.self = loop;
    expect(redactSecrets(loop)).toEqual({ a: { n: 1 }, b: { n: 1 }, self: "[Circular]" });
  });

  it("TC-NOUS44_DEV-20 1行の JSON に時刻・水準・メッセージ・項目を出し、秘密を伏せる", () => {
    const { lines, sink } = capture();
    const logger = createLogger({ level: "info", sinks: [sink], now: fixedNow });
    logger.info("login", { path: "/admin/api/login", password: "secret-value" });
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain("secret-value");
    expect(JSON.parse(lines[0] ?? "")).toEqual({
      time: "2026-10-20T00:00:00.000Z",
      level: "info",
      msg: "login",
      path: "/admin/api/login",
      password: REDACTED,
    });
  });

  it("TC-NOUS44_DEV-21 設定した水準より下のログは出さない", () => {
    const { lines, sink } = capture();
    const logger = createLogger({ level: "warn", sinks: [sink], now: fixedNow });
    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");
    expect(lines.map((l) => JSON.parse(l).level)).toEqual(["warn", "error"]);
  });

  it("TC-NOUS44_DEV-22 Error をスタック付きで出し、child の項目を毎行に付ける", () => {
    const { lines, sink } = capture();
    const logger = createLogger({ sinks: [sink], now: fixedNow }).child({ module: "admin", token: "t" });
    logger.error("failed", { err: new Error("boom") });
    const record = JSON.parse(lines[0] ?? "");
    expect(record.module).toBe("admin");
    expect(record.token).toBe(REDACTED);
    expect(record.err.message).toBe("boom");
    expect(typeof record.err.stack).toBe("string");
  });
});
