import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../../test/helpers/testDb";
import { TEST_ADMIN_ID, TEST_NOW, seedAdmin } from "../../../test/helpers/adminTestSupport";
import { FakeClock } from "../../clock/fakeClock";
import { admin_audit_logs, worlds } from "../../db/schema";
import { withTx } from "../../db/tx";
import { isUlid } from "../../lib/ids";
import { recordAudit } from "./auditService";

describe("auditService", () => {
  let t: TestDb;
  const clock = new FakeClock(TEST_NOW);
  beforeEach(() => {
    t = createTestDb();
    seedAdmin(t.db);
  });
  afterEach(() => t.cleanup());

  it("TC-NOUS52_DEV-13 recordAudit が ULID と Clock の時刻で1行を残し、before・after を JSON にする", () => {
    const id = withTx(t.db, (tx) =>
      recordAudit(tx, clock, {
        adminId: TEST_ADMIN_ID,
        operation: "settings.update",
        targetType: "settings",
        targetId: "s1",
        before: { cycleMinutes: 30 },
        after: { cycleMinutes: 15 },
      }),
    );
    expect(isUlid(id)).toBe(true);
    const row = t.db.select().from(admin_audit_logs).get();
    expect(row).toMatchObject({
      audit_id: id,
      admin_id: TEST_ADMIN_ID,
      operation: "settings.update",
      target_type: "settings",
      target_id: "s1",
      before_json: '{"cycleMinutes":30}',
      after_json: '{"cycleMinutes":15}',
      world_id: null,
      operated_at: TEST_NOW.toISOString(),
    });
  });

  it("TC-NOUS52_DEV-14 before・after が undefined なら NULL、null なら JSON の null", () => {
    recordAudit(t.db, clock, { adminId: TEST_ADMIN_ID, operation: "admin.login", targetType: "admin", after: null });
    const row = t.db.select().from(admin_audit_logs).get();
    expect(row?.before_json).toBeNull();
    expect(row?.after_json).toBe("null");
  });

  it("TC-NOUS52_DEV-15 呼び出し元のトランザクションが失敗したら、監査の行も残らない", () => {
    expect(() =>
      withTx(t.db, (tx) => {
        tx.insert(worlds)
          .values({ world_id: "01JB0000000000000000000001", name: "世界", created_at: TEST_NOW.toISOString() })
          .run();
        recordAudit(tx, clock, { adminId: TEST_ADMIN_ID, operation: "world.start", targetType: "world" });
        throw new Error("後続の失敗");
      }),
    ).toThrow("後続の失敗");
    expect(t.db.select().from(admin_audit_logs).all()).toHaveLength(0);
  });

  it("TC-NOUS52_DEV-16 区分の外の operation は DB の制約で拒まれる", () => {
    expect(() =>
      recordAudit(t.db, clock, {
        adminId: TEST_ADMIN_ID,
        operation: "unknown.op" as "world.start",
        targetType: "world",
      }),
    ).toThrow();
  });
});
