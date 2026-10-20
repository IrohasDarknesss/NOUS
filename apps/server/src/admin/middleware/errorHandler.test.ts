import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createTestDb } from "../../../test/helpers/testDb";
import { captureLogger } from "../../../test/helpers/adminTestSupport";
import { worlds } from "../../db/schema";
import { AppError } from "../../lib/errors";
import type { AdminEnv } from "../context";
import { errorHandler, toAppError } from "./errorHandler";

function appThrowing(err: () => unknown) {
  const captured = captureLogger();
  const a = new Hono<AdminEnv>();
  a.onError(errorHandler);
  a.use("*", async (c, next) => {
    c.set("logger", captured.logger);
    await next();
  });
  a.get("/x", () => {
    throw err();
  });
  return { a, lines: captured.lines };
}

describe("errorHandler", () => {
  it("TC-NOUS52_DEV-09 AppError を status と code・message・fields の本文で返す", async () => {
    const { a, lines } = appThrowing(() => new AppError("HANDLE_TAKEN", { fields: { handle: "使われています" } }));
    const res = await a.request("/x");
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: { code: "HANDLE_TAKEN", message: "このハンドルは使われています", fields: { handle: "使われています" } },
    });
    expect(lines()[0]).toMatchObject({ level: "info", code: "HANDLE_TAKEN", path: "/x" });
  });

  it("TC-NOUS52_DEV-10 ZodError を 400 VALIDATION_ERROR と項目ごとのメッセージにする", async () => {
    const schema = z.object({ label: z.string().min(1, "1〜30 字で入力してください") });
    const { a } = appThrowing(() => schema.safeParse({ label: "" }).error);
    const res = await a.request("/x");
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR", fields: { label: "1〜30 字で入力してください" } },
    });
  });

  it("TC-NOUS52_DEV-11 想定外の例外は 500 INTERNAL_ERROR の固定の文言で返し、スタックはログだけに出す", async () => {
    const { a, lines } = appThrowing(() => new Error("secret detail"));
    const res = await a.request("/x");
    expect(res.status).toBe(500);
    const body = await res.text();
    expect(body).not.toContain("secret detail");
    expect(JSON.parse(body)).toMatchObject({
      error: { code: "INTERNAL_ERROR", message: "処理に失敗しました。時間をおいて再度お試しください" },
    });
    const log = lines()[0] as { level: string; err: { stack?: string } };
    expect(log.level).toBe("error");
    expect(log.err.stack).toContain("secret detail");
  });

  it("TC-NOUS52_DEV-12 SqliteError の UNIQUE の違反は SQL の文を出さずに 409 CONFLICT にする", () => {
    const t = createTestDb();
    try {
      const row = { world_id: "01JB0000000000000000000001", name: "世界", created_at: "2026-10-20T00:00:00.000Z" };
      t.db.insert(worlds).values(row).run();
      let caught: unknown;
      try {
        t.db.insert(worlds).values(row).run();
      } catch (err) {
        caught = err;
      }
      const captured = captureLogger();
      const appError = toAppError(caught, captured.logger, "/x");
      expect(appError.code).toBe("CONFLICT");
      expect(appError.status).toBe(409);
      const log = captured.lines()[0] as Record<string, unknown>;
      expect(log).toMatchObject({ level: "error", msg: "sqlite_error", uniqueViolation: true });
      expect(JSON.stringify(log)).not.toContain("INSERT");
    } finally {
      t.cleanup();
    }
  });

  it("TC-NOUS52_DEV-23 UNIQUE 以外の SqliteError（CHECK の違反）は 500 INTERNAL_ERROR にする", () => {
    const t = createTestDb();
    try {
      let caught: unknown;
      try {
        t.db
          .insert(worlds)
          .values({ world_id: "01JB0000000000000000000001", name: "世界", created_at: "not-a-date" })
          .run();
      } catch (err) {
        caught = err;
      }
      const captured = captureLogger();
      const appError = toAppError(caught, captured.logger, "/x");
      expect(appError.code).toBe("INTERNAL_ERROR");
      expect(captured.lines()[0]).toMatchObject({ level: "error", msg: "sqlite_error", uniqueViolation: false });
    } finally {
      t.cleanup();
    }
  });
});
