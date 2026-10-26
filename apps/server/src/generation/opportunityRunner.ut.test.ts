// 単体テスト（NOUS-104）。観点表は docs/test/unit/NOUS-104/観点表_opportunityRunner.json
import { asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SEED_DATE,
  SEED_NOW,
  seedAgent,
  seedEvent,
  seedRunningWorld,
  seedWorld,
} from "../../test/helpers/generationSeed";
import { createTestDb, type TestDb } from "../../test/helpers/testDb";
import { FakeClock } from "../clock/fakeClock";
import { parseGenerationConfig, type GenerationConfig } from "../config/generationConfig";
import { agents, daily_metrics, daily_usage, generation_attempts, generation_events, likes } from "../db/schema";
import { createLogger } from "../lib/logger";
import {
  FreeTierExceededError,
  ServerError,
  TimeoutError,
  type LlmClient,
  type LlmRequest,
  type LlmResult,
} from "../llm/llmClient";
import { DuplicateActionError } from "./actionApplier";
import {
  closeCancelled,
  closeFailed,
  commitAction,
  createEvent,
  generateAndValidate,
  runOpportunity,
  type OpportunityContext,
} from "./opportunityRunner";
import type { BuiltPrompt, UsedAttributes } from "./promptBuilder";
import { StoppedError } from "./retryPolicy";

const NONE_JSON = '{"action":"none","target":null,"text":null}';
const POST_JSON = '{"action":"post","target":null,"text":"港の風が心地よい朝です。"}';

function makeConfig(participationProb = 1): GenerationConfig {
  return parseGenerationConfig({
    participation: {
      "1": participationProb,
      "2": participationProb,
      "3": participationProb,
      "4": participationProb,
      "5": participationProb,
    },
    candidateCount: 4,
    weights: { post: 1, reply: 1, like: 1, follow: 1, unfollow: 1 },
    recentPenalty: 0.4,
    firstPersonRules: [{ keywords: ["僕"], mismatch: ["私", "わたし"] }],
  });
}

function makeLlmResult(text: string, overrides: Partial<LlmResult> = {}): LlmResult {
  return {
    text,
    promptTokens: 600,
    completionTokens: 40,
    neurons: 6.5,
    httpStatus: 200,
    durationMs: 500,
    ...overrides,
  };
}

/** 呼ばれるたびに順に返す（または投げる）LlmClient。呼ばれた要求を requests に残す */
function scriptedLlm(
  steps: Array<LlmResult | Error | (() => LlmResult | Error)>,
): LlmClient & { requests: LlmRequest[] } {
  const requests: LlmRequest[] = [];
  return {
    requests,
    async generate(req: LlmRequest) {
      requests.push(req);
      const raw = steps[Math.min(requests.length - 1, steps.length - 1)];
      const step = typeof raw === "function" ? raw() : raw;
      if (step instanceof Error) throw step;
      return step!;
    },
  };
}

/** sleep が張られるまで、Promise の続きを流す（実時間では待たない） */
async function waitForSleeps(clock: FakeClock, count = 1): Promise<void> {
  for (let i = 0; i < 100 && clock.pendingCount() < count; i++) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

const PROMPT = {
  messages: [
    { role: "system", content: "system" },
    { role: "user", content: "user" },
  ],
  refs: [],
  usedMemories: [],
  usedAttributes: {} as UsedAttributes,
} satisfies BuiltPrompt;

describe("opportunityRunner（単体テスト）", () => {
  let t: TestDb;
  let worldId: string;
  let minato: string;
  let clock: FakeClock;
  let logLines: string[];

  beforeEach(() => {
    t = createTestDb();
    worldId = seedRunningWorld(t.db, { worldElapsedSec: 120 });
    minato = seedAgent(t.db, worldId, "minato");
    seedAgent(t.db, worldId, "haruka");
    clock = new FakeClock(new Date(SEED_NOW));
    logLines = [];
  });

  afterEach(() => {
    t.cleanup();
  });

  const makeCtx = (llm: LlmClient, overrides: Partial<OpportunityContext> = {}): OpportunityContext => ({
    db: t.db,
    clock,
    llm,
    config: makeConfig(1),
    logger: createLogger({ level: "debug", now: () => clock.now(), sinks: [(line) => logLines.push(line)] }),
    llmMode: "fixed",
    worldId,
    agentId: minato,
    cycleNo: 1,
    cycleSeed: 42,
    signal: new AbortController().signal,
    shouldContinue: () => true,
    ...overrides,
  });

  const eventOf = (id: string | null) =>
    t.db
      .select()
      .from(generation_events)
      .where(eq(generation_events.event_id, id ?? ""))
      .get();
  const attemptsOf = (id: string | null) =>
    t.db
      .select()
      .from(generation_attempts)
      .where(eq(generation_attempts.event_id, id ?? ""))
      .orderBy(asc(generation_attempts.attempt_no))
      .all();
  const metricsOf = (date: string) => t.db.select().from(daily_metrics).where(eq(daily_metrics.usage_date, date)).get();
  const usageOf = (date: string) => t.db.select().from(daily_usage).where(eq(daily_usage.usage_date, date)).get();

  it("TC-UT_RUN-001 世界が無ければ生成イベントを作らずに例外を投げる", async () => {
    const llm = scriptedLlm([makeLlmResult(NONE_JSON)]);

    const promise = runOpportunity(makeCtx(llm, { worldId: "01J000000000000000NOWORLD0" }));

    await expect(promise).rejects.toThrow("World not found");
    expect(t.db.select().from(generation_events).all()).toHaveLength(0);
  });

  it("TC-UT_RUN-002 world_settings が無ければ生成イベントを作らずに例外を投げる", async () => {
    const bareWorld = seedWorld(t.db);
    const bareAgent = seedAgent(t.db, bareWorld, "zen");
    const llm = scriptedLlm([makeLlmResult(NONE_JSON)]);

    const promise = runOpportunity(makeCtx(llm, { worldId: bareWorld, agentId: bareAgent }));

    await expect(promise).rejects.toThrow("World settings not found");
    expect(t.db.select().from(generation_events).all()).toHaveLength(0);
  });

  it("TC-UT_RUN-003 LLM が none を選んだら succeeded・decided_by=llm で閉じ、daily_metrics は runs と nones を 1 加算する", async () => {
    const llm = scriptedLlm([makeLlmResult(NONE_JSON)]);

    const res = await runOpportunity(makeCtx(llm));

    expect(res).toMatchObject({ status: "succeeded", action: "none", decidedBy: "llm", failureKind: null });
    expect(eventOf(res.eventId)).toMatchObject({ status: "succeeded", action: "none", decided_by: "llm" });
    expect(metricsOf(SEED_DATE)).toMatchObject({ runs: 1, nones: 1, posts: 0, failures: 0 });
    expect(usageOf(SEED_DATE)).toMatchObject({ calls: 1, runs: 1 });
  });

  it("TC-UT_RUN-004 最初の生成で 3 試行かかって不正な形式なら、再生成は 4 回目の 1 回だけで、失敗すれば timeout で閉じる", async () => {
    const llm = scriptedLlm([
      new TimeoutError("t1"),
      new TimeoutError("t2"),
      makeLlmResult("JSON ではない"),
      new TimeoutError("t4"),
      makeLlmResult(POST_JSON),
    ]);
    const promise = runOpportunity(makeCtx(llm));
    await waitForSleeps(clock);
    await clock.advance(30_000);
    await waitForSleeps(clock);

    await clock.advance(120_000);
    const res = await promise;

    expect(res).toMatchObject({ status: "failed", failureKind: "timeout" });
    expect(llm.requests).toHaveLength(4);
    expect(attemptsOf(res.eventId).map((a) => [a.attempt_no, a.result])).toEqual([
      [1, "timeout"],
      [2, "timeout"],
      [3, "invalid_format"],
      [4, "timeout"],
    ]);
    expect(clock.pendingCount()).toBe(0);
  });

  it("TC-UT_RUN-005 最初の生成が 1 試行で不正な形式なら、再生成の側は 2〜4 回目の 3 回まで再試行する", async () => {
    const llm = scriptedLlm([
      makeLlmResult("JSON ではない"),
      new TimeoutError("t2"),
      new TimeoutError("t3"),
      new TimeoutError("t4"),
    ]);
    const promise = runOpportunity(makeCtx(llm));
    await waitForSleeps(clock);
    await clock.advance(30_000);
    await waitForSleeps(clock);

    await clock.advance(120_000);
    const res = await promise;

    expect(res).toMatchObject({ status: "failed", failureKind: "timeout" });
    expect(llm.requests).toHaveLength(4);
    expect(attemptsOf(res.eventId).map((a) => [a.attempt_no, a.result])).toEqual([
      [1, "invalid_format"],
      [2, "timeout"],
      [3, "timeout"],
      [4, "timeout"],
    ]);
    expect(usageOf(SEED_DATE)).toMatchObject({ calls: 4, runs: 1 });
  });

  it("TC-UT_RUN-006 生成イベントを作った後にエージェントが停止されたら、LLM を呼ばずに cancelled（stopped）で閉じる", async () => {
    const base = makeConfig(1);
    const config: GenerationConfig = {
      ...base,
      get participation() {
        t.db.update(agents).set({ state: "stopped" }).where(eq(agents.agent_id, minato)).run();
        return base.participation;
      },
    };
    const llm = scriptedLlm([makeLlmResult(POST_JSON)]);

    const res = await runOpportunity(makeCtx(llm, { config }));

    expect(res).toMatchObject({ status: "cancelled", failureKind: "stopped", action: null });
    expect(llm.requests).toHaveLength(0);
    expect(eventOf(res.eventId)).toMatchObject({ status: "cancelled", failure_kind: "stopped" });
    expect(metricsOf(SEED_DATE)).toMatchObject({ runs: 1, failures: 0 });
  });

  it("TC-UT_RUN-007 再生成の側が再試行しない失敗（401）なら server_error で閉じ、output_text に 1 回目の不正な出力を残す", async () => {
    const llm = scriptedLlm([makeLlmResult("broken 1"), new ServerError("unauthorized", { httpStatus: 401 })]);

    const res = await runOpportunity(makeCtx(llm));

    expect(res).toMatchObject({ status: "failed", failureKind: "server_error" });
    expect(eventOf(res.eventId)).toMatchObject({
      status: "failed",
      failure_kind: "server_error",
      output_text: "broken 1",
    });
    expect(metricsOf(SEED_DATE)).toMatchObject({ runs: 1, failures: 1 });
  });

  it.each([
    { at: "2026-10-22T23:59:59.999Z", date: "2026-10-22" },
    { at: "2026-10-23T00:00:00.000Z", date: "2026-10-23" },
  ])("TC-UT_RUN-008 createEvent は usage_date を時計の UTC の日付にする（$at）", ({ at, date }) => {
    clock = new FakeClock(new Date(at));
    const ctx = makeCtx(scriptedLlm([]));

    const eventId = createEvent(ctx);

    expect(eventOf(eventId)).toMatchObject({ status: "running", decided_by: "llm", usage_date: date, started_at: at });
  });

  it("TC-UT_RUN-009 00:00 UTC をまたいで再試行したら、試行は呼んだ日の daily_usage に、指標は生成イベントの日の daily_metrics に入る", async () => {
    clock = new FakeClock(new Date("2026-10-22T23:59:50.000Z"));
    const llm = scriptedLlm([new TimeoutError("t1"), makeLlmResult(POST_JSON, { neurons: 6.5 })]);
    const promise = runOpportunity(makeCtx(llm));
    await waitForSleeps(clock);

    await clock.advance(30_000);
    const res = await promise;

    expect(res.status).toBe("succeeded");
    expect(eventOf(res.eventId)?.usage_date).toBe("2026-10-22");
    expect(usageOf("2026-10-22")).toMatchObject({ calls: 1, runs: 1, neurons: 0 });
    expect(usageOf("2026-10-23")).toMatchObject({ calls: 1, runs: 0, neurons: 6.5 });
    expect(metricsOf("2026-10-22")).toMatchObject({ runs: 1, posts: 1 });
    expect(metricsOf("2026-10-23")).toBeUndefined();
  });

  it("TC-UT_RUN-010 commitAction は DuplicateActionError 以外の例外（外部キーの違反）ならロールバックして、そのまま投げる", () => {
    const ctx = makeCtx(scriptedLlm([]));
    const eventId = createEvent(ctx);
    const minatoRow = t.db.select().from(agents).where(eq(agents.agent_id, minato)).get()!;

    let thrown: unknown;
    try {
      commitAction(
        eventId,
        { action: "like", targetRef: "P1", targetPostId: "01J00000000000000NOPOST000" },
        { agent: minatoRow },
        '{"action":"like","target":"P1","text":null}',
        ctx,
      );
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).not.toBeInstanceOf(DuplicateActionError);
    expect(t.db.select().from(likes).all()).toHaveLength(0);
    expect(eventOf(eventId)).toMatchObject({ status: "running", finished_at: null });
    expect(metricsOf(SEED_DATE)).toBeUndefined();
  });

  it("TC-UT_RUN-011 closeCancelled は生成イベントが見つからないとき、時計の UTC の日付の daily_metrics に runs を加算する", () => {
    clock = new FakeClock(new Date("2026-10-23T01:00:00.000Z"));

    closeCancelled("01J0000000000000000NOEVENT", "cancelled", makeCtx(scriptedLlm([])));

    expect(metricsOf("2026-10-23")).toMatchObject({ runs: 1, failures: 0 });
  });

  it("TC-UT_RUN-012 closeFailed は lastOutput が null なら output_text を上書きしない", () => {
    const ctx = makeCtx(scriptedLlm([]));
    const eventId = createEvent(ctx);
    t.db
      .update(generation_events)
      .set({ output_text: "前の出力" })
      .where(eq(generation_events.event_id, eventId))
      .run();

    closeFailed(eventId, "server_error", null, ctx);

    expect(eventOf(eventId)).toMatchObject({ status: "failed", failure_kind: "server_error", output_text: "前の出力" });
  });

  it("TC-UT_RUN-013 generateAndValidate は設定が DB にも ctx にも無ければ、既定のモデル・出力の上限 300 で呼び、ハンドルを DB から読む", async () => {
    const bareWorld = seedWorld(t.db);
    const zen = seedAgent(t.db, bareWorld, "zen");
    const eventId = seedEvent(t.db, bareWorld, zen);
    const llm = scriptedLlm([makeLlmResult(NONE_JSON)]);

    const valid = await generateAndValidate(
      eventId,
      PROMPT,
      ["post"],
      makeCtx(llm, { worldId: bareWorld, agentId: zen, cycleNo: 7 }),
    );

    expect(valid).toEqual({ action: "none" });
    expect(llm.requests[0]).toMatchObject({
      modelId: "@cf/google/gemma-4-26b-a4b-it",
      maxTokens: 300,
      fixtureKey: { handle: "zen", cycleNo: 7 },
    });
  });

  it("TC-UT_RUN-014 generateAndValidate は ctx の settings・validationContext・handle を渡されたら、それを使い DB の文脈を読まない", async () => {
    const eventId = createEvent(makeCtx(scriptedLlm([])));
    t.db.update(agents).set({ state: "stopped" }).where(eq(agents.agent_id, minato)).run();
    const llm = scriptedLlm([makeLlmResult(NONE_JSON)]);

    const valid = await generateAndValidate(eventId, PROMPT, ["post"], {
      ...makeCtx(llm),
      settings: { model_id: "@cf/qwen/qwen3-30b-a3b-fp8", max_output_tokens: 150 },
      validationContext: { agentId: minato, refs: [], likeablePostIds: [], followTargets: [], followees: [] },
      handle: "given_handle",
    });

    expect(valid).toEqual({ action: "none" });
    expect(llm.requests[0]).toMatchObject({
      modelId: "@cf/qwen/qwen3-30b-a3b-fp8",
      maxTokens: 150,
      fixtureKey: { handle: "given_handle" },
    });
  });

  it("TC-UT_RUN-015 generateAndValidate は validationContext だけ渡されてハンドルが無ければ、エージェントからハンドルを読む", async () => {
    const eventId = createEvent(makeCtx(scriptedLlm([])));
    const llm = scriptedLlm([makeLlmResult(NONE_JSON)]);

    await generateAndValidate(eventId, PROMPT, ["post"], {
      ...makeCtx(llm),
      validationContext: { agentId: minato, refs: [], likeablePostIds: [], followTargets: [], followees: [] },
    });

    expect(llm.requests[0]?.fixtureKey.handle).toBe("minato");
  });

  it("TC-UT_RUN-016 generateAndValidate は world_settings が無いとき ctx.settings の Neurons の上限で待ちの後の停止を判定する", async () => {
    const bareWorld = seedWorld(t.db);
    const zen = seedAgent(t.db, bareWorld, "zen");
    const eventId = seedEvent(t.db, bareWorld, zen);
    t.db.insert(daily_usage).values({ usage_date: SEED_DATE, calls: 3, runs: 3, neurons: 100 }).run();
    const llm = scriptedLlm([new TimeoutError("t1"), makeLlmResult(NONE_JSON)]);
    const promise = generateAndValidate(eventId, PROMPT, ["post"], {
      ...makeCtx(llm, { worldId: bareWorld, agentId: zen }),
      settings: {
        model_id: "@cf/google/gemma-4-26b-a4b-it",
        max_output_tokens: 300,
        daily_neurons_limit: 100,
        daily_runs_limit: 480,
      },
    });
    const assertion = expect(promise).rejects.toBeInstanceOf(StoppedError);
    await waitForSleeps(clock);

    await clock.advance(30_000);

    await assertion;
    expect(llm.requests).toHaveLength(1);
  });

  it("TC-UT_RUN-017 不正な形式の試行で使った Neurons も、daily_usage・生成イベント・戻り値の neurons に入る", async () => {
    const llm = scriptedLlm([makeLlmResult("JSON ではない", { neurons: 4 }), makeLlmResult(POST_JSON, { neurons: 7 })]);

    const res = await runOpportunity(makeCtx(llm));

    expect(res).toMatchObject({ status: "succeeded", neurons: 11 });
    expect(eventOf(res.eventId)?.neurons).toBe(11);
    expect(usageOf(SEED_DATE)).toMatchObject({ calls: 2, runs: 1, neurons: 11 });
  });

  it("TC-UT_RUN-018 1 回目が不正な形式のとき、その呼び出し中に stopSignal が abort されていたら、再生成を呼ばずに cancelled（stopped）で閉じる", async () => {
    const stopController = new AbortController();
    const llm = scriptedLlm([
      () => {
        stopController.abort();
        return makeLlmResult("JSON ではない");
      },
      makeLlmResult(POST_JSON),
    ]);

    const res = await runOpportunity(makeCtx(llm, { stopSignal: stopController.signal }));

    expect(llm.requests).toHaveLength(1);
    expect(res).toMatchObject({ status: "cancelled", failureKind: "stopped", action: null });
    expect(eventOf(res.eventId)).toMatchObject({ status: "cancelled", failure_kind: "stopped" });
  });

  it("TC-UT_RUN-019 再生成の側で 3036 になったら free_tier で閉じて投げ直し、output_text に 1 回目の出力を残す", async () => {
    const llm = scriptedLlm([
      makeLlmResult("broken 1"),
      new FreeTierExceededError("free tier", { httpStatus: 429, detail: "code 3036" }),
    ]);

    const promise = runOpportunity(makeCtx(llm));

    await expect(promise).rejects.toBeInstanceOf(FreeTierExceededError);
    const event = t.db.select().from(generation_events).get();
    expect(event).toMatchObject({ status: "failed", failure_kind: "free_tier", output_text: "broken 1" });
    expect(attemptsOf(event?.event_id ?? null).map((a) => a.result)).toEqual(["invalid_format", "free_tier"]);
  });

  it("TC-UT_RUN-020 再試行の待ちの途中で signal と stopSignal の両方が abort されたら、緊急停止を優先して cancelled（cancelled）で閉じる", async () => {
    const controller = new AbortController();
    const stopController = new AbortController();
    const llm = scriptedLlm([new TimeoutError("t1")]);
    const promise = runOpportunity(makeCtx(llm, { signal: controller.signal, stopSignal: stopController.signal }));
    await waitForSleeps(clock);

    stopController.abort();
    controller.abort();
    const res = await promise;

    expect(res).toMatchObject({ status: "cancelled", failureKind: "cancelled" });
    expect(eventOf(res.eventId)).toMatchObject({ status: "cancelled", failure_kind: "cancelled" });
  });

  it("TC-UT_RUN-021 1 回目が不正な形式で、再生成の前に世界が止まっていたら（shouldContinue が false）、再生成を呼ばずに cancelled（stopped）で閉じる", async () => {
    let running = true;
    const llm = scriptedLlm([
      () => {
        running = false;
        return makeLlmResult("JSON ではない");
      },
      makeLlmResult(POST_JSON),
    ]);

    const res = await runOpportunity(makeCtx(llm, { shouldContinue: () => running }));

    expect(llm.requests).toHaveLength(1);
    expect(res).toMatchObject({ status: "cancelled", failureKind: "stopped" });
  });

  it("TC-UT_RUN-022 createEvent は世界が無ければ例外を投げ、生成イベントを作らない", () => {
    const ctx = makeCtx(scriptedLlm([]), { worldId: "01J000000000000000NOWORLD0" });

    expect(() => createEvent(ctx)).toThrow("World not found");

    expect(t.db.select().from(generation_events).all()).toHaveLength(0);
  });

  it("TC-UT_RUN-023 createEvent は world_settings が無ければ例外を投げ、生成イベントを作らない", () => {
    const bareWorld = seedWorld(t.db);
    const ctx = makeCtx(scriptedLlm([]), { worldId: bareWorld, agentId: seedAgent(t.db, bareWorld, "zen") });

    expect(() => createEvent(ctx)).toThrow("World settings not found");

    expect(t.db.select().from(generation_events).all()).toHaveLength(0);
  });
});
