// 単体テスト（NOUS-96）。観点表は docs/test/unit/NOUS-96/観点表_fixedClient.json
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeClock } from "../clock/fakeClock.js";
import { createFixedClient, FixtureError, fixturePath, loadFixture, type LlmClock } from "./fixedClient.js";
import {
  CancelledError,
  FreeTierExceededError,
  isLlmError,
  RateLimitedError,
  ServerError,
  TimeoutError,
  type LlmRequest,
} from "./llmClient.js";

const START = new Date("2026-10-22T09:00:00.000Z");

/** sleep を実時間で待たず、呼ばれた ms を記録して時刻だけ進める時計 */
class RecordingClock implements LlmClock {
  ms = START.getTime();
  sleeps: number[] = [];
  now(): Date {
    return new Date(this.ms);
  }
  async sleep(ms: number): Promise<void> {
    this.sleeps.push(ms);
    this.ms += ms;
  }
}

function request(handle: string, cycleNo: number, signal: AbortSignal = new AbortController().signal): LlmRequest {
  return {
    modelId: "@cf/google/gemma-4-26b-a4b-it",
    messages: [
      { role: "system", content: "s" },
      { role: "user", content: "u" },
    ],
    maxTokens: 200,
    signal,
    fixtureKey: { handle, cycleNo },
  };
}

/** 失敗を値として受け取る。成功したら失敗にする */
async function rejectionOf(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (err) {
    return err;
  }
  throw new Error("拒否されませんでした");
}

describe("fixedClient（単体テスト）", () => {
  let dir: string;

  async function put(name: string, body: unknown): Promise<void> {
    await writeFile(join(dir, "s1", name), typeof body === "string" ? body : JSON.stringify(body), "utf8");
  }

  function client(clock: LlmClock = new RecordingClock()): ReturnType<typeof createFixedClient> {
    return createFixedClient({ fixtureDir: dir, scenario: "s1", clock });
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "nous96-"));
    await mkdir(join(dir, "s1"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("TC-UT_LLM-006 ハンドルは 3 字と 20 字なら受け付ける", () => {
    const twenty = "a".repeat(20);

    const short = fixturePath("fixtures/llm", "basic", { handle: "abc", cycleNo: 1 });
    const long = fixturePath("fixtures/llm", "basic", { handle: twenty, cycleNo: 1 });

    expect(short).toBe(join("fixtures/llm", "basic", "abc-1.json"));
    expect(long).toBe(join("fixtures/llm", "basic", `${twenty}-1.json`));
  });

  it("TC-UT_LLM-007 ハンドルが 21 字なら FixtureError", () => {
    const act = (): string => fixturePath("fixtures/llm", "basic", { handle: "a".repeat(21), cycleNo: 1 });

    expect(act).toThrow(FixtureError);
  });

  it("TC-UT_LLM-008 ハンドルにハイフンを含むと FixtureError", () => {
    const act = (): string => fixturePath("fixtures/llm", "basic", { handle: "min-ato", cycleNo: 1 });

    expect(act).toThrow(FixtureError);
  });

  it.each(["a", "s".repeat(40), "long-run"])(
    "TC-UT_LLM-009 シナリオの名前は 1 字・40 字・ハイフン入りなら受け付ける（%j）",
    (scenario) => {
      const path = fixturePath("fixtures/llm", scenario, { handle: "minato", cycleNo: 1 });

      expect(path).toBe(join("fixtures/llm", scenario, "minato-1.json"));
    },
  );

  it.each(["", "s".repeat(41)])("TC-UT_LLM-010 シナリオの名前が空か 41 字なら FixtureError（%j）", (scenario) => {
    const act = (): string => fixturePath("fixtures/llm", scenario, { handle: "minato", cycleNo: 1 });

    expect(act).toThrow(FixtureError);
  });

  it("TC-UT_LLM-011 巡の番号は 1 なら受け付ける", () => {
    const path = fixturePath("fixtures/llm", "basic", { handle: "minato", cycleNo: 1 });

    expect(path).toBe(join("fixtures/llm", "basic", "minato-1.json"));
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1])(
    "TC-UT_LLM-012 巡の番号が NaN・Infinity・負なら FixtureError（%j）",
    (cycleNo) => {
      const act = (): string => fixturePath("fixtures/llm", "basic", { handle: "minato", cycleNo });

      expect(act).toThrow(FixtureError);
    },
  );

  it("TC-UT_LLM-013 ENOENT 以外で読めなければ FixtureError（null にしない）", async () => {
    await mkdir(join(dir, "s1", "aoi-1.json"));

    const err = await rejectionOf(loadFixture(join(dir, "s1", "aoi-1.json")));

    expect(err).toBeInstanceOf(FixtureError);
    expect(((err as FixtureError).cause as NodeJS.ErrnoException).code).toBe("EISDIR");
  });

  it("TC-UT_LLM-014 ハンドルが不正なら FixtureError を投げ、LlmError にはしない", async () => {
    const err = await rejectionOf(client().generate(request("../etc", 1)));

    expect(err).toBeInstanceOf(FixtureError);
    expect(isLlmError(err)).toBe(false);
  });

  it("TC-UT_LLM-015 text と error の両方があるファイルは error の失敗を起こす", async () => {
    await put("aoi-1.json", { text: "x", error: "timeout" });

    const err = await rejectionOf(client().generate(request("aoi", 1)));

    expect(err).toBeInstanceOf(TimeoutError);
  });

  it("TC-UT_LLM-016 delayMs が 0 なら時計の sleep を呼ばない", async () => {
    await put("aoi-1.json", { text: "x", delayMs: 0 });
    const clock = new RecordingClock();

    const result = await client(clock).generate(request("aoi", 1));

    expect(clock.sleeps).toEqual([]);
    expect(result.durationMs).toBe(0);
  });

  it("TC-UT_LLM-017 delayMs が 1 なら 1 ms だけ sleep する", async () => {
    await put("aoi-1.json", { text: "x", delayMs: 1 });
    const clock = new RecordingClock();

    const result = await client(clock).generate(request("aoi", 1));

    expect(clock.sleeps).toEqual([1]);
    expect(result.durationMs).toBe(1);
  });

  it("TC-UT_LLM-018 時計の sleep が取り消し以外で失敗し、signal も abort されていなければ、その例外をそのまま投げる", async () => {
    await put("aoi-1.json", { text: "x", delayMs: 10 });
    const broken = new Error("clock broken");
    const clock: LlmClock = { now: () => START, sleep: () => Promise.reject(broken) };

    const err = await rejectionOf(client(clock).generate(request("aoi", 1)));

    expect(err).toBe(broken);
  });

  it("TC-UT_LLM-019 sleep が終わった時点で abort されていたら CancelledError", async () => {
    await put("aoi-1.json", { text: "x", delayMs: 10 });
    const controller = new AbortController();
    const reason = new Error("emergency stop");
    const clock: LlmClock = {
      now: () => START,
      sleep: async () => {
        controller.abort(reason);
      },
    };

    const err = await rejectionOf(client(clock).generate(request("aoi", 1, controller.signal)));

    expect(err).toBeInstanceOf(CancelledError);
    expect((err as CancelledError).cause).toBe(reason);
  });

  it("TC-UT_LLM-020 FakeClock を渡すと、時計を進めるまで応答を返さず、durationMs は進めた時間になる", async () => {
    await put("aoi-1.json", { text: "x", delayMs: 8000 });
    const clock = new FakeClock(START);
    let settled = false;
    const pending = client(clock)
      .generate(request("aoi", 1))
      .finally(() => (settled = true));
    await waitForPending(clock);

    await clock.advance(7999);
    const beforeDue = settled;
    await clock.advance(1);
    const result = await pending;

    expect(beforeDue).toBe(false);
    expect(result.durationMs).toBe(8000);
  });

  it("TC-UT_LLM-021 FakeClock で待っている間に abort したら CancelledError", async () => {
    await put("aoi-1.json", { text: "x", delayMs: 8000 });
    const clock = new FakeClock(START);
    const controller = new AbortController();
    const pending = client(clock).generate(request("aoi", 1, controller.signal));
    await waitForPending(clock);

    controller.abort();
    const err = await rejectionOf(pending);

    expect(err).toBeInstanceOf(CancelledError);
    expect(clock.pendingCount()).toBe(0);
  });

  it("TC-UT_LLM-022 usage の項目が 1 つでも欠けたら FixtureError", async () => {
    await put("aoi-1.json", { text: "x", usage: { prompt_tokens: 1, completion_tokens: 1 } });

    const err = await rejectionOf(loadFixture(join(dir, "s1", "aoi-1.json")));

    expect(err).toBeInstanceOf(FixtureError);
  });

  it("TC-UT_LLM-023 usage のトークンと neurons が 0 なら受け付ける", async () => {
    await put("aoi-1.json", { text: "x", usage: { prompt_tokens: 0, completion_tokens: 0, neurons: 0 } });

    const fixture = await loadFixture(join(dir, "s1", "aoi-1.json"));

    expect(fixture?.usage).toEqual({ prompt_tokens: 0, completion_tokens: 0, neurons: 0 });
  });

  it("TC-UT_LLM-024 usage のトークンが -1 なら FixtureError", async () => {
    await put("aoi-1.json", { text: "x", usage: { prompt_tokens: -1, completion_tokens: 0, neurons: 0 } });

    const err = await rejectionOf(loadFixture(join(dir, "s1", "aoi-1.json")));

    expect(err).toBeInstanceOf(FixtureError);
  });

  it.each([
    { text: "x", usage: { prompt_tokens: 1.5, completion_tokens: 0, neurons: 0 } },
    { text: "x", delayMs: 1.5 },
  ])("TC-UT_LLM-025 トークン数と delayMs が整数でなければ FixtureError（%j）", async (body) => {
    await put("aoi-1.json", body);

    const err = await rejectionOf(loadFixture(join(dir, "s1", "aoi-1.json")));

    expect(err).toBeInstanceOf(FixtureError);
  });

  it("TC-UT_LLM-026 text が空文字なら none にせず空文字を返す", async () => {
    await put("aoi-1.json", { text: "" });

    const result = await client().generate(request("aoi", 1));

    expect(result.text).toBe("");
    expect(result.httpStatus).toBe(200);
  });

  it.each([
    ["free_tier", FreeTierExceededError, false],
    ["rate_limited", RateLimitedError, true],
    ["server_error", ServerError, true],
    ["timeout", TimeoutError, true],
  ] as const)(
    "TC-UT_LLM-027 固定応答の free_tier は再試行せず、rate_limited と server_error は再試行の対象になる（%s）",
    async (error, type, retryable) => {
      await put("aoi-1.json", { error });

      const err = await rejectionOf(client().generate(request("aoi", 1)));

      expect(err).toBeInstanceOf(type);
      expect((err as InstanceType<typeof type>).retryable).toBe(retryable);
    },
  );
});

/** generate がファイルを読み終えて FakeClock の sleep を張るまで待つ（ファイルの読み込みは実際の I/O のため） */
async function waitForPending(clock: FakeClock): Promise<void> {
  for (let i = 0; i < 100 && clock.pendingCount() === 0; i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  expect(clock.pendingCount()).toBe(1);
}
