// 単体テスト（NOUS-96）。観点表は docs/test/unit/NOUS-96/観点表_fixedClient.json
import { describe, expect, it } from "vitest";
import { createLlmError, ServerError, TimeoutError } from "./llmClient.js";

describe("llmClient（単体テスト）", () => {
  it("TC-UT_LLM-001 detail が 500 字ちょうどなら切らず、501 字なら 500 字に切る", () => {
    const just = "a".repeat(500);
    const over = "b".repeat(501);

    const e500 = new ServerError("x", { detail: just });
    const e501 = new ServerError("x", { detail: over });

    expect(e500.detail).toBe(just);
    expect(e501.detail).toBe("b".repeat(500));
  });

  it("TC-UT_LLM-002 detail が空文字なら null にせず空文字のまま持つ", () => {
    const e = new TimeoutError("x", { detail: "" });

    expect(e.detail).toBe("");
  });

  it("TC-UT_LLM-003 cause を渡さなければ cause を持たず、null を渡せば null を持つ", () => {
    const without = new TimeoutError("x");
    const withNull = new TimeoutError("x", { cause: null });

    expect("cause" in without).toBe(false);
    expect("cause" in withNull).toBe(true);
    expect(withNull.cause).toBeNull();
  });

  it.each([399, 402, null])(
    "TC-UT_LLM-004 400・401 の隣の 399・402 は再試行し、httpStatus が null も再試行する（%j）",
    (httpStatus) => {
      const e = new ServerError("x", { httpStatus });

      expect(e.httpStatus).toBe(httpStatus);
      expect(e.retryable).toBe(true);
    },
  );

  it("TC-UT_LLM-005 createLlmError は options（httpStatus・detail・cause）をそのまま渡す", () => {
    const cause = new Error("root");

    const e = createLlmError("server_error", "msg", { httpStatus: 500, detail: "d", cause });

    expect(e).toBeInstanceOf(ServerError);
    expect(e.message).toBe("msg");
    expect(e.httpStatus).toBe(500);
    expect(e.detail).toBe("d");
    expect(e.cause).toBe(cause);
  });
});
