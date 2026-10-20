// 管理サーバーのテストの下ごしらえ（管理者とセッションを DB に入れる）。テストからだけ使う
import { FakeClock } from "../../src/clock/fakeClock";
import type { Db } from "../../src/db/client";
import { admin_account, admin_sessions } from "../../src/db/schema";
import { createLogger, type Logger } from "../../src/lib/logger";
import { randomToken, sha256Hex } from "../../src/lib/tokens";
import type { AdminDeps } from "../../src/admin/context";

export const TEST_ADMIN_ID = "01JB00000000000000000ADMIN";
export const TEST_NOW = new Date("2026-10-20T00:00:00.000Z");

export function captureLogger(): { logger: Logger; lines: () => Record<string, unknown>[] } {
  const raw: string[] = [];
  const logger = createLogger({ level: "debug", sinks: [(line) => raw.push(line)], now: () => TEST_NOW });
  return { logger, lines: () => raw.map((l) => JSON.parse(l) as Record<string, unknown>) };
}

export function testDeps(db: Db, clock = new FakeClock(TEST_NOW)): AdminDeps & { clock: FakeClock } {
  return { db, clock, logger: captureLogger().logger };
}

export function seedAdmin(db: Db, now: Date = TEST_NOW): void {
  db.insert(admin_account)
    .values({
      admin_id: TEST_ADMIN_ID,
      display_name: "Kaine Yamashiro",
      password_hash: "scrypt$16384$8$1$x$y",
      updated_at: now.toISOString(),
    })
    .run();
}

/** セッションを1つ作り、Cookie の値と CSRF トークンを返す */
export function seedSession(
  db: Db,
  createdAt: Date = TEST_NOW,
  lastSeenAt: Date = createdAt,
): { cookie: string; csrfToken: string; sessionHash: string } {
  const cookie = randomToken(32);
  const csrfToken = randomToken(32);
  const sessionHash = sha256Hex(cookie);
  db.insert(admin_sessions)
    .values({
      session_hash: sessionHash,
      admin_id: TEST_ADMIN_ID,
      csrf_token: csrfToken,
      created_at: createdAt.toISOString(),
      last_seen_at: lastSeenAt.toISOString(),
    })
    .run();
  return { cookie, csrfToken, sessionHash };
}
