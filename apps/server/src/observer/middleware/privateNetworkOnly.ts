// 送信元の私設アドレスの検査（BE 詳細設計 observer 4章 privateNetworkOnly・isPrivateIPv4、6章）
import { createMiddleware } from "hono/factory";
import { AppError } from "../../lib/errors";
import type { Logger } from "../../lib/logger";
import type { ObserverEnv } from "../context";

const IPV4_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** IPv4 の形で、10.0.0.0/8・172.16.0.0/12・192.168.0.0/16・127.0.0.0/8 のどれかに入るか */
export function isPrivateIPv4(addr: string): boolean {
  const m = IPV4_PATTERN.exec(addr);
  if (!m) return false;
  const octets = m.slice(1, 5).map(Number);
  if (octets.some((n) => n > 255)) return false;
  const [a, b] = octets as [number, number, number, number];
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/** IPv4 射影の IPv6（::ffff:192.168.1.10）の接頭辞を外す */
export function normalizeRemoteAddress(addr: string): string {
  return addr.toLowerCase().startsWith("::ffff:") ? addr.slice("::ffff:".length) : addr;
}

/**
 * 送信元が私設 IPv4 でなければ 403 FORBIDDEN_NETWORK。
 * 送信元はソケットのアドレスだけを見る。X-Forwarded-For は見ない（代理サーバーを置かないため）
 */
export function privateNetworkOnly(logger: Logger) {
  return createMiddleware<ObserverEnv>(async (c, next) => {
    const raw = c.env?.incoming?.socket?.remoteAddress ?? "";
    const addr = normalizeRemoteAddress(raw);
    if (!isPrivateIPv4(addr)) {
      logger.warn("observer: 私設アドレス以外からの要求を拒否", { remoteAddress: raw });
      throw new AppError("FORBIDDEN_NETWORK");
    }
    await next();
  });
}
