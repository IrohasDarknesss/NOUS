// 単体テスト（NOUS-90）。観点表は docs/test/unit/NOUS-90/観点表_lib.json
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "./errors";
import { REDACTED, createLogger, fileSink, isSecretKey, redactSecrets, stdoutSink } from "./logger";

const fixedNow = () => new Date("2026-10-22T09:00:00.000Z");

function capture() {
  const lines: string[] = [];
  return { lines, sink: (line: string) => lines.push(line) };
}

describe("logger（単体テスト）", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("TC-UT_LIB-038 redactSecrets は null・数値・文字列・真偽値をそのまま返す", () => {
    expect(redactSecrets(null)).toBeNull();
    expect(redactSecrets(42)).toBe(42);
    expect(redactSecrets("token")).toBe("token");
    expect(redactSecrets(false)).toBe(false);
  });

  it("TC-UT_LIB-039 Date は ISO 8601 の文字列にする（いちばん外と入れ子の両方）", () => {
    const at = new Date("2026-10-22T09:00:00.000Z");

    expect(redactSecrets(at)).toBe("2026-10-22T09:00:00.000Z");
    expect(redactSecrets({ at })).toEqual({ at: "2026-10-22T09:00:00.000Z" });
  });

  it("TC-UT_LIB-040 秘密のキーの値がオブジェクトや配列でも、まるごと伏せる", () => {
    const out = redactSecrets({ password: { hash: "x", salt: "y" }, token: ["a", "b"], n: 1 });

    expect(out).toEqual({ password: REDACTED, token: REDACTED, n: 1 });
  });

  it("TC-UT_LIB-041 Error は name・message・stack と、自分の項目（AppError の code・fields など）を出し、秘密の項目は伏せる", () => {
    const err = Object.assign(new AppError("VALIDATION_ERROR", { fields: { label: "1〜30 字" } }), {
      csrfToken: "secret-csrf",
    });

    const out = redactSecrets({ err }) as unknown as { err: Record<string, unknown> };

    expect(out.err).toMatchObject({
      name: "AppError",
      message: "入力の内容を確認してください",
      code: "VALIDATION_ERROR",
      status: 400,
      fields: { label: "1〜30 字" },
      csrfToken: REDACTED,
    });
    expect(typeof out.err.stack).toBe("string");
  });

  it.each([
    ["clientSecret", true],
    ["x_api_token", true],
    ["Set-Cookie", true],
    ["COOKIE", true],
    ["secretary", false],
    ["max_tokens", false],
  ])(
    "TC-UT_LIB-042 isSecretKey は secret で終わるキーも秘密とし、似ているだけのキーは秘密としない（%s）",
    (key, expected) => {
      expect(isSecretKey(key)).toBe(expected);
    },
  );

  it.each([
    ["debug", ["debug", "info", "warn", "error"]],
    ["error", ["error"]],
  ] as const)("TC-UT_LIB-043 水準の下限・上限（%s）で出すログが決まる", (level, expected) => {
    const { lines, sink } = capture();
    const logger = createLogger({ level, sinks: [sink], now: fixedNow });

    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");

    expect(lines.map((l) => JSON.parse(l).level)).toEqual(expected);
  });

  it("TC-UT_LIB-044 水準を指定しなければ info 以上を出す", () => {
    const { lines, sink } = capture();
    const logger = createLogger({ sinks: [sink], now: fixedNow });

    logger.debug("d");
    logger.info("i");

    expect(lines.map((l) => JSON.parse(l).level)).toEqual(["info"]);
  });

  it("TC-UT_LIB-045 出力先が複数なら、同じ1行をそれぞれに渡す", () => {
    const a = capture();
    const b = capture();
    const logger = createLogger({ sinks: [a.sink, b.sink], now: fixedNow });

    logger.warn("w", { n: 1 });

    expect(a.lines).toHaveLength(1);
    expect(b.lines).toEqual(a.lines);
  });

  it("TC-UT_LIB-046 child を重ねると項目を合わせ、呼び出しの項目が child の項目より優先される", () => {
    const { lines, sink } = capture();
    const logger = createLogger({ sinks: [sink], now: fixedNow })
      .child({ module: "scheduler" })
      .child({ cycleNo: 1 });

    logger.info("cycle", { cycleNo: 2, worldId: "W1" });

    expect(JSON.parse(lines[0] ?? "")).toEqual({
      time: "2026-10-22T09:00:00.000Z",
      level: "info",
      msg: "cycle",
      module: "scheduler",
      cycleNo: 2,
      worldId: "W1",
    });
  });

  it("TC-UT_LIB-047 出力先を指定しなければ、標準出力に1行ずつ改行付きで書く", () => {
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const logger = createLogger({ now: fixedNow });

    logger.info("started");
    stdoutSink("raw");

    expect(write).toHaveBeenNthCalledWith(
      1,
      `${JSON.stringify({ time: "2026-10-22T09:00:00.000Z", level: "info", msg: "started" })}\n`,
    );
    expect(write).toHaveBeenNthCalledWith(2, "raw\n");
  });

  describe("fileSink", () => {
    let dir: string;

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), "nous-logger-ut-"));
    });

    afterEach(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    it("TC-UT_LIB-048 fileSink はディレクトリがなければ作り、1行ずつ追記する", () => {
      const path = join(dir, "logs", "nested", "app.log");
      const sink = fileSink(path);

      sink('{"n":1}');
      sink('{"n":2}');

      expect(readFileSync(path, "utf8")).toBe('{"n":1}\n{"n":2}\n');
    });
  });
});
