import { describe, expect, it } from "vitest";
import { CancelledError as ClockCancelledError, ConfigError as ClockConfigError } from "../clock/clock.js";
import { ConfigError as GenerationConfigError } from "../config/generationConfig.js";
import { AppError, CancelledError, ConfigError, ERROR_CODES, isAppError } from "./errors.js";

// 基本設計書 概要 7章と BE 詳細設計（admin_auth・admin_data・generation・observer・world）に出るエラーコード
const DESIGN_CODES: Record<string, number> = {
  VALIDATION_ERROR: 400,
  CONFIRM_MISMATCH: 400,
  ADMIN_UNAUTHORIZED: 401,
  LOGIN_FAILED: 401,
  VIEW_NOT_INVITED: 401,
  CSRF_INVALID: 403,
  FORBIDDEN_NETWORK: 403,
  AGENT_NOT_FOUND: 404,
  POST_NOT_FOUND: 404,
  EVENT_NOT_FOUND: 404,
  WORLD_NOT_FOUND: 404,
  INVITATION_NOT_FOUND: 404,
  WRITE_NOT_ALLOWED: 405,
  STATE_CONFLICT: 409,
  CONFLICT: 409,
  ADMIN_NOT_SET: 409,
  NO_AGENTS: 409,
  GENERATION_RUNNING: 409,
  HANDLE_TAKEN: 409,
  ALREADY_STOPPED: 409,
  ALREADY_ACTIVE: 409,
  ALREADY_HIDDEN: 409,
  NOT_HIDDEN: 409,
  ALREADY_REVOKED: 409,
  LAN_ADDRESS_NOT_FOUND: 409,
  LOGIN_LOCKED: 429,
  INTERNAL_ERROR: 500,
};

describe("errors", () => {
  it("TC-NOUS44_DEV-01 エラーコードの定数が設計書のコードと状態に一致する", () => {
    const actual = Object.fromEntries(Object.entries(ERROR_CODES).map(([code, def]) => [code, def.status]));
    expect(actual).toEqual(DESIGN_CODES);
  });

  it("TC-NOUS44_DEV-02 AppError がコードから status と既定のメッセージを引く", () => {
    const err = new AppError("HANDLE_TAKEN");
    expect(err.status).toBe(409);
    expect(err.message).toBe("このハンドルは使われています");
    expect(err.fields).toEqual({});
    expect(isAppError(err)).toBe(true);
    expect(isAppError(new Error("x"))).toBe(false);
  });

  it("TC-NOUS44_DEV-03 メッセージと fields を差し替え、エラーの本文の形にする", () => {
    const err = new AppError("VALIDATION_ERROR", { message: "入力が違います", fields: { label: "1〜30 字" } });
    expect(err.toBody()).toEqual({
      error: { code: "VALIDATION_ERROR", message: "入力が違います", fields: { label: "1〜30 字" } },
    });
  });

  it("TC-NOUS44_DEV-04 INTERNAL_ERROR の既定のメッセージが固定の文言である", () => {
    expect(new AppError("INTERNAL_ERROR").message).toBe("処理に失敗しました。時間をおいて再度お試しください");
  });

  it("TC-NOUS44_DEV-05 ConfigError が問題をすべて持つ", () => {
    const err = new ConfigError(["A: x", "B: y"]);
    expect(err.problems).toEqual(["A: x", "B: y"]);
    expect(err.message).toContain("A: x");
    expect(err.message).toContain("B: y");
  });

  it("TC-NOUS44_DEV-32 ConfigError が1つの問題の文字列と cause を受ける", () => {
    const cause = new Error("ENOENT");
    const err = new ConfigError("config/generation.json を読めません", { cause });
    expect(err.message).toBe("config/generation.json を読めません");
    expect(err.problems).toEqual(["config/generation.json を読めません"]);
    expect(err.cause).toBe(cause);
    expect(err.name).toBe("ConfigError");
  });

  it("TC-NOUS76_DEV-01 clock・generationConfig が使う ConfigError は lib/errors.ts のものと同じ", () => {
    expect(ClockConfigError).toBe(ConfigError);
    expect(GenerationConfigError).toBe(ConfigError);
  });

  it("TC-NOUS76_DEV-02 clock が使う CancelledError は lib/errors.ts のものと同じ", () => {
    expect(ClockCancelledError).toBe(CancelledError);
  });

  it("TC-NOUS76_DEV-03 CancelledError の既定の文言と name、cause を持つ", () => {
    const cause = new Error("abort");
    const err = new CancelledError(undefined, { cause });
    expect(err.message).toBe("cancelled");
    expect(err.name).toBe("CancelledError");
    expect(err.cause).toBe(cause);
    expect(new CancelledError("待ちを打ち切りました").message).toBe("待ちを打ち切りました");
  });
});
