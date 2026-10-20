import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../test/helpers/testDb";
import { BUSY_TIMEOUT_MS, openDb, closeDb } from "./client";
import { runMigrations } from "./migrate";
import { TABLE_NAMES, worlds } from "./schema";
import { withTx } from "./tx";

const SCHEMA_SQL = fileURLToPath(new URL("../../../../docs/design/detailed/schema.sql", import.meta.url));

/** DB 物理設計書 4章のインデックス（26 件） */
const INDEX_NAMES = [
  "ux_worlds_current",
  "ux_agents_world_handle",
  "idx_agents_world_state",
  "idx_posts_timeline",
  "idx_posts_root",
  "idx_posts_reply_to",
  "idx_posts_agent",
  "idx_posts_world_created",
  "ux_likes_agent_post",
  "idx_likes_post",
  "ux_follows_active",
  "idx_follows_followee_active",
  "idx_follows_world",
  "ux_memories_agent_kind",
  "idx_gen_world_started",
  "idx_gen_world_agent",
  "idx_gen_world_status",
  "idx_gen_llm_recent",
  "ux_attempts_event_no",
  "idx_hide_post",
  "idx_hide_operated",
  "idx_view_logs_accessed",
  "ux_admin_single",
  "idx_sessions_admin",
  "idx_audit_operated",
  "idx_audit_operation",
];

type MasterRow = { type: string; name: string; tbl_name: string; sql: string | null };

/** sqlite_master の表とインデックス（drizzle の管理表を除く） */
function masterRows(sqlite: Database.Database): MasterRow[] {
  return sqlite
    .prepare(
      "SELECT type, name, tbl_name, sql FROM sqlite_master " +
        "WHERE type IN ('table', 'index') AND name NOT LIKE '__drizzle%' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all() as MasterRow[];
}

const NOW = "2026-10-21T09:00:00.000Z";
const WORLD_ID = "01JB0000000000000000000001";

describe("DB のスキーマとマイグレーション", () => {
  let t: TestDb;
  beforeEach(() => {
    t = createTestDb();
  });
  afterEach(() => {
    t.cleanup();
  });

  it("TC-NOUS43_DEV-01 マイグレーションで 17 テーブルが STRICT で作られる", () => {
    const rows = masterRows(t.db.$client).filter((r) => r.type === "table");
    expect(rows.map((r) => r.name).sort()).toEqual([...TABLE_NAMES].sort());
    const strict = t.db.$client.prepare("PRAGMA table_list").all() as { name: string; strict: number }[];
    for (const name of TABLE_NAMES) {
      expect(strict.find((r) => r.name === name)?.strict, name).toBe(1);
    }
  });

  it("TC-NOUS43_DEV-02 DB 物理設計書 4章の 26 のインデックスが作られる", () => {
    const names = masterRows(t.db.$client)
      .filter((r) => r.type === "index")
      .map((r) => r.name)
      .sort();
    expect(names).toEqual([...INDEX_NAMES].sort());
  });

  it("TC-NOUS43_DEV-03 テーブル・インデックス・制約の定義が schema.sql と一致する", () => {
    const ref = new Database(":memory:");
    try {
      ref.exec(readFileSync(SCHEMA_SQL, "utf-8"));
      expect(masterRows(t.db.$client)).toEqual(masterRows(ref));
    } finally {
      ref.close();
    }
  });

  it("TC-NOUS43_DEV-04 マイグレーションを2回適用しても失敗せず、適用の記録は1件のまま", () => {
    expect(() => runMigrations(t.db)).not.toThrow();
    const count = t.db.$client.prepare("SELECT count(*) AS n FROM __drizzle_migrations").get() as { n: number };
    expect(count.n).toBe(1);
  });

  it("TC-NOUS43_DEV-05 openDb が foreign_keys・WAL・busy_timeout を設定する", () => {
    const c = t.db.$client;
    expect(c.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(c.pragma("journal_mode", { simple: true })).toBe("wal");
    expect(c.pragma("busy_timeout", { simple: true })).toBe(BUSY_TIMEOUT_MS);
  });

  it("TC-NOUS43_DEV-06 CHECK 制約が区分値の外の値を拒む", () => {
    expect(() =>
      t.db.$client
        .prepare("INSERT INTO worlds (world_id, name, state, created_at) VALUES (?, ?, ?, ?)")
        .run(WORLD_ID, "世界", "unknown", NOW),
    ).toThrow(/CHECK constraint failed/);
  });

  it("TC-NOUS43_DEV-07 外部キーの違反を拒む（存在しない世界のエージェント）", () => {
    expect(() =>
      t.db.$client
        .prepare(
          "INSERT INTO agents (agent_id, world_id, handle, display_name, interests, topics, personality, values_text, stance, created_at, updated_at) " +
            "VALUES (?, ?, 'ai_one', 'AI', 'a', 'b', 'c', 'd', 'e', ?, ?)",
        )
        .run("01JB0000000000000000000A01", WORLD_ID, NOW, NOW),
    ).toThrow(/FOREIGN KEY constraint failed/);
  });

  it("TC-NOUS43_DEV-08 archived 以外の世界は1つしか作れない（ux_worlds_current）", () => {
    t.db.insert(worlds).values({ world_id: WORLD_ID, name: "世界1", created_at: NOW }).run();
    expect(() =>
      t.db.insert(worlds).values({ world_id: "01JB0000000000000000000002", name: "世界2", created_at: NOW }).run(),
    ).toThrow(/UNIQUE constraint failed/);
  });
});

describe("withTx", () => {
  let t: TestDb;
  beforeEach(() => {
    t = createTestDb();
  });
  afterEach(() => {
    t.cleanup();
  });

  const countWorlds = () => (t.db.$client.prepare("SELECT count(*) AS n FROM worlds").get() as { n: number }).n;

  it("TC-NOUS43_DEV-09 正常に終われば書き込みを確定し、fn の戻り値を返す", () => {
    const result = withTx(t.db, (tx) => {
      tx.insert(worlds).values({ world_id: WORLD_ID, name: "世界", created_at: NOW }).run();
      return "ok";
    });
    expect(result).toBe("ok");
    expect(countWorlds()).toBe(1);
  });

  it("TC-NOUS43_DEV-10 fn が投げたら全体を取り消し、同じエラーを投げ直す", () => {
    const boom = new Error("boom");
    expect(() =>
      withTx(t.db, (tx) => {
        tx.insert(worlds).values({ world_id: WORLD_ID, name: "世界", created_at: NOW }).run();
        throw boom;
      }),
    ).toThrow(boom);
    expect(countWorlds()).toBe(0);
  });

  it("TC-NOUS43_DEV-11 fn が Promise を返したら取り消して TypeError を投げる", () => {
    expect(() =>
      withTx(t.db, (tx) => {
        tx.insert(worlds).values({ world_id: WORLD_ID, name: "世界", created_at: NOW }).run();
        return Promise.resolve(1);
      }),
    ).toThrow(TypeError);
    expect(countWorlds()).toBe(0);
  });

  it("TC-NOUS43_DEV-12 制約の違反（SqliteError）でも全体を取り消す", () => {
    expect(() =>
      withTx(t.db, (tx) => {
        tx.insert(worlds).values({ world_id: WORLD_ID, name: "世界", created_at: NOW }).run();
        tx.run(sql`INSERT INTO worlds (world_id, name, created_at) VALUES ('short', 'x', ${NOW})`);
      }),
    ).toThrow(/CHECK constraint failed/);
    expect(countWorlds()).toBe(0);
  });
});

describe("テスト用の DB のヘルパー", () => {
  it("TC-NOUS43_DEV-13 createTestDb は一時ファイルの DB を作り、cleanup で閉じて消す", () => {
    const t = createTestDb();
    expect(existsSync(t.path)).toBe(true);
    t.cleanup();
    expect(existsSync(t.path)).toBe(false);
    expect(t.db.$client.open).toBe(false);
    expect(() => t.cleanup()).not.toThrow();
  });

  it("TC-NOUS43_DEV-14 openDb はファイルの置き場所のディレクトリがなければ作る", () => {
    const t = createTestDb();
    try {
      const nested = t.path.replace(/test\.db$/, "nested/dir/x.db");
      const db = openDb(nested);
      closeDb(db);
      expect(existsSync(nested)).toBe(true);
    } finally {
      t.cleanup();
    }
  });
});
