import { describe, expect, it } from "vitest";
import {
  CancelledError,
  createLlmError,
  FreeTierExceededError,
  InvalidFormatError,
  isLlmError,
  LlmError,
  RateLimitedError,
  ServerError,
  TimeoutError,
  type LlmErrorKind,
} from "./llmClient.js";

describe("LlmClient のエラーの型", () => {
  it.each<[LlmErrorKind, new (message: string) => LlmError, boolean]>([
    ["timeout", TimeoutError, true],
    ["rate_limited", RateLimitedError, true],
    ["free_tier", FreeTierExceededError, false],
    ["server_error", ServerError, true],
    ["invalid_format", InvalidFormatError, false],
    ["cancelled", CancelledError, false],
  ])("TC-NOUS47_DEV-01 createLlmError(%s) が対応する型・kind・再試行の可否を返す", (kind, type, retryable) => {
    const e = createLlmError(kind, "msg");
    expect(e).toBeInstanceOf(type);
    expect(e).toBeInstanceOf(LlmError);
    expect(e).toBeInstanceOf(Error);
    expect(e.kind).toBe(kind);
    expect(e.retryable).toBe(retryable);
    expect(e.name).toBe(type.name);
    expect(e.httpStatus).toBeNull();
    expect(e.detail).toBeNull();
  });

  it("TC-NOUS47_DEV-02 ServerError は 400・401 だけ再試行しない", () => {
    expect(new ServerError("x", { httpStatus: 400 }).retryable).toBe(false);
    expect(new ServerError("x", { httpStatus: 401 }).retryable).toBe(false);
    expect(new ServerError("x", { httpStatus: 500 }).retryable).toBe(true);
    expect(new ServerError("x", { httpStatus: 503 }).retryable).toBe(true);
    expect(new ServerError("x", { httpStatus: 200 }).retryable).toBe(true);
  });

  it("TC-NOUS47_DEV-03 detail は 500 字で切り詰め、httpStatus と cause を保つ", () => {
    const cause = new Error("root");
    const e = new RateLimitedError("x", { httpStatus: 429, detail: "a".repeat(600), cause });
    expect(e.detail).toHaveLength(500);
    expect(e.httpStatus).toBe(429);
    expect(e.cause).toBe(cause);
  });

  it("TC-NOUS47_DEV-04 isLlmError は LlmError だけを真にする", () => {
    expect(isLlmError(new TimeoutError("x"))).toBe(true);
    expect(isLlmError(new Error("x"))).toBe(false);
    expect(isLlmError("timeout")).toBe(false);
    expect(isLlmError(null)).toBe(false);
  });
});
