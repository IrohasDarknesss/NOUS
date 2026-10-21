import { asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SEED_DATE, SEED_NOW, seedAgent, seedRunningWorld } from "../../test/helpers/generationSeed";
import { createTestDb, type TestDb } from "../../test/helpers/testDb";
import { FakeClock } from "../clock/fakeClock";
import { parseGenerationConfig, type GenerationConfig } from "../config/generationConfig";
import {
  agents,
  daily_metrics,
  daily_usage,
  generation_attempts,
  generation_events,
  likes,
  memories,
  posts,
} from "../db/schema";
import { CancelledError as ClockCancelledError } from "../lib/errors";
import { createLogger } from "../lib/logger";
import {
  CancelledError as LlmCancelledError,
  FreeTierExceededError,
  RateLimitedError,
  TimeoutError,
  type LlmClient,
  type LlmRequest,
  type LlmResult,
} from "../llm/llmClient";
import {
  closeCancelled,
  closeFailed,
  closeGateNone,
  commitAction,
  createEvent,
  runOpportunity,
  type OpportunityContext,
} from "./opportunityRunner";
import { recordAttempt } from "./usageRecorder";

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
    weights: {
      post: 1,
      reply: 1,
      like: 1,
      follow: 1,
      unfollow: 1,
    },
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

describe("opportunityRunner（2章・4章・6章 runOpportunity）", () => {
  let t: TestDb;
  let worldId: string;
  let minato: string;
  let haruka: string;
  let clock: FakeClock;
  let logLines: string[];

  beforeEach(() => {
    t = createTestDb();
    worldId = seedRunningWorld(t.db, { worldElapsedSec: 120 });
    minato = seedAgent(t.db, worldId, "minato", { personality: "一人称は僕で穏やか" });
    haruka = seedAgent(t.db, worldId, "haruka");
    clock = new FakeClock(new Date(SEED_NOW));
    logLines = [];
  });

  afterEach(() => {
    t.cleanup();
  });

  const makeLogger = () =>
    createLogger({
      level: "debug",
      now: () => clock.now(),
      sinks: [(line) => logLines.push(line)],
    });

  const makeCtx = (llm: LlmClient, overrides: Partial<OpportunityContext> = {}): OpportunityContext => ({
    db: t.db,
    clock,
    llm,
    config: makeConfig(1),
    logger: makeLogger(),
    llmMode: "fixed",
    worldId,
    agentId: minato,
    cycleNo: 1,
    cycleSeed: 42,
    signal: new AbortController().signal,
    shouldContinue: () => true,
    ...overrides,
  });

  it("TC-NOUS63_DEV-15 対象のエージェントが稼働中でなければ生成イベントを作らず skipped を返す", async () => {
    const stoppedAgent = seedAgent(t.db, worldId, "stopped_user", { state: "stopped" });
    let llmCalled = false;
    const llm: LlmClient = {
      async generate() {
        llmCalled = true;
        return makeLlmResult('{"action":"none","target":null,"text":null}');
      },
    };

    const res = await runOpportunity(makeCtx(llm, { agentId: stoppedAgent }));
    expect(res).toEqual({
      eventId: null,
      status: "skipped",
      action: null,
      decidedBy: null,
      neurons: 0,
      failureKind: null,
    });
    expect(llmCalled).toBe(false);
    expect(t.db.select().from(generation_events).all()).toHaveLength(0);
  });

  it("TC-NOUS63_DEV-16 gate で不参加のときは closeGateNone で閉じ、LLM を呼ばず daily_metrics.nones だけ +1 する", async () => {
    let llmCalled = false;
    const llm: LlmClient = {
      async generate() {
        llmCalled = true;
        return makeLlmResult('{"action":"none","target":null,"text":null}');
      },
    };

    const res = await runOpportunity(makeCtx(llm, { config: makeConfig(0) }));
    expect(res.status).toBe("succeeded");
    expect(res.action).toBe("none");
    expect(res.decidedBy).toBe("gate");
    expect(res.neurons).toBe(0);
    expect(res.failureKind).toBeNull();
    expect(llmCalled).toBe(false);

    const event = t.db
      .select()
      .from(generation_events)
      .where(eq(generation_events.event_id, res.eventId ?? ""))
      .get();
    expect(event).toMatchObject({
      status: "succeeded",
      action: "none",
      decided_by: "gate",
      finished_at: SEED_NOW,
    });

    const metrics = t.db.select().from(daily_metrics).where(eq(daily_metrics.world_id, worldId)).get();
    expect(metrics).toMatchObject({
      runs: 0,
      nones: 1,
      failures: 0,
    });
    expect(t.db.select().from(daily_usage).all()).toHaveLength(0);
  });

  it("TC-NOUS63_DEV-17 参加して post が成功すると入力・出力・投稿・記憶・矛盾フラグ・daily_usage・daily_metrics が記録される", async () => {
    const outputJson = '{"action":"post","target":null,"text":"私は朝の港を散歩しています。"}';
    const llm: LlmClient = {
      async generate(req: LlmRequest) {
        expect(req.messages).toHaveLength(2);
        return makeLlmResult(outputJson, {
          promptTokens: 800,
          completionTokens: 50,
          neurons: 8.5,
        });
      },
    };

    const res = await runOpportunity(makeCtx(llm));
    expect(res).toEqual({
      eventId: expect.any(String),
      status: "succeeded",
      action: "post",
      decidedBy: "llm",
      neurons: 8.5,
      failureKind: null,
    });

    const event = t.db
      .select()
      .from(generation_events)
      .where(eq(generation_events.event_id, res.eventId ?? ""))
      .get();
    expect(event).toMatchObject({
      status: "succeeded",
      decided_by: "llm",
      action: "post",
      output_text: outputJson,
      prompt_tokens: 800,
      completion_tokens: 50,
      neurons: 8.5,
      world_time_sec: 120,
      finished_at: SEED_NOW,
    });
    expect(event?.prompt_text).toContain("minato");
    expect(JSON.parse(event?.action_candidates ?? "[]")).toContain("post");
    // 性格「一人称は僕」に対して本文に「私」があるため C03 が記録される
    expect(JSON.parse(event?.consistency_flags ?? "[]")).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "C03" })]),
    );

    const postRows = t.db.select().from(posts).where(eq(posts.agent_id, minato)).all();
    expect(postRows).toHaveLength(1);
    expect(postRows[0]?.body).toBe("私は朝の港を散歩しています。");

    const memRows = t.db.select().from(memories).where(eq(memories.agent_id, minato)).all();
    expect(memRows.length).toBeGreaterThan(0);

    const usage = t.db.select().from(daily_usage).where(eq(daily_usage.usage_date, SEED_DATE)).get();
    expect(usage).toMatchObject({
      calls: 1,
      runs: 1,
      prompt_tokens: 800,
      completion_tokens: 50,
      neurons: 8.5,
    });

    const metrics = t.db.select().from(daily_metrics).where(eq(daily_metrics.world_id, worldId)).get();
    expect(metrics).toMatchObject({
      runs: 1,
      posts: 1,
      failures: 0,
    });
  });

  it("TC-NOUS63_DEV-18 1 回目の出力が不正な形式でも同じ prompt で 1 回だけ再生成して成功できる", async () => {
    let callCount = 0;
    const llm: LlmClient = {
      async generate() {
        callCount += 1;
        if (callCount === 1) {
          return makeLlmResult("これは JSON ではありません", { neurons: 4.0 });
        }
        return makeLlmResult('{"action":"post","target":null,"text":"2 回目の生成で成功しました。"}', {
          neurons: 7.0,
        });
      },
    };

    const res = await runOpportunity(makeCtx(llm));
    expect(res).toMatchObject({
      status: "succeeded",
      action: "post",
      decidedBy: "llm",
      neurons: 7.0,
      failureKind: null,
    });
    expect(callCount).toBe(2);

    const attempts = t.db
      .select()
      .from(generation_attempts)
      .where(eq(generation_attempts.event_id, res.eventId ?? ""))
      .orderBy(asc(generation_attempts.attempt_no))
      .all();
    expect(attempts).toHaveLength(2);
    expect(attempts[0]).toMatchObject({
      attempt_no: 1,
      result: "invalid_format",
      neurons: 0,
    });
    expect(attempts[1]).toMatchObject({
      attempt_no: 2,
      result: "ok",
      neurons: 7.0,
    });

    const usage = t.db.select().from(daily_usage).where(eq(daily_usage.usage_date, SEED_DATE)).get();
    expect(usage).toMatchObject({
      calls: 2,
      runs: 1,
      neurons: 7.0,
    });
  });

  it("TC-NOUS63_DEV-19 再生成でも不正な形式なら closeFailed（invalid_format）で閉じ、最後の output_text を残す", async () => {
    let callCount = 0;
    const llm: LlmClient = {
      async generate() {
        callCount += 1;
        return makeLlmResult(`broken output ${callCount}`);
      },
    };

    const res = await runOpportunity(makeCtx(llm));
    expect(res).toMatchObject({
      status: "failed",
      action: null,
      decidedBy: "llm",
      neurons: 0,
      failureKind: "invalid_format",
    });
    expect(callCount).toBe(2);

    const event = t.db
      .select()
      .from(generation_events)
      .where(eq(generation_events.event_id, res.eventId ?? ""))
      .get();
    expect(event).toMatchObject({
      status: "failed",
      failure_kind: "invalid_format",
      output_text: "broken output 2",
      finished_at: SEED_NOW,
    });
    // LLM を呼ぶ前に書き込んだ prompt_text が残っていること
    expect(event?.prompt_text).toBeTruthy();

    const metrics = t.db.select().from(daily_metrics).where(eq(daily_metrics.world_id, worldId)).get();
    expect(metrics).toMatchObject({
      runs: 1,
      failures: 1,
    });
  });

  it("TC-NOUS63_DEV-20 commitAction で DuplicateActionError が起きたらロールバックし、別トランザクションで invalid_format と error_detail を記録する", () => {
    const ctx = makeCtx({
      async generate() {
        return makeLlmResult('{"action":"none","target":null,"text":null}');
      },
    });

    // haruka の投稿と minato の既存のいいねを用意する
    const setupEventId = createEvent({ ...ctx, agentId: haruka });
    const postId = "01J0000000000000000000POST";
    t.db
      .insert(posts)
      .values({
        post_id: postId,
        world_id: worldId,
        agent_id: haruka,
        body: "テストの投稿",
        reply_to_post_id: null,
        root_post_id: postId,
        depth: 0,
        world_time_sec: 100,
        created_at: SEED_NOW,
        generation_event_id: setupEventId,
      })
      .run();

    const firstLikeEventId = createEvent(ctx);
    t.db
      .insert(likes)
      .values({
        like_id: "01J0000000000000000000LIKE",
        world_id: worldId,
        agent_id: minato,
        post_id: postId,
        world_time_sec: 110,
        created_at: SEED_NOW,
        generation_event_id: firstLikeEventId,
      })
      .run();

    // 同じ投稿に 2 回目のいいねを commitAction で反映しようとすると DuplicateActionError になる
    const dupEventId = createEvent(ctx);
    recordAttempt(t.db, {
      eventId: dupEventId,
      attemptNo: 1,
      result: "ok",
      httpStatus: 200,
      promptTokens: 500,
      completionTokens: 20,
      neurons: 5.0,
      durationMs: 300,
      startedAt: SEED_NOW,
      usageDate: SEED_DATE,
    });

    const minatoRow = t.db.select().from(agents).where(eq(agents.agent_id, minato)).get()!;
    const commitRes = commitAction(
      dupEventId,
      { action: "like", targetRef: "P1", targetPostId: postId },
      { agent: minatoRow },
      '{"action":"like","target":"P1","text":null}',
      ctx,
    );

    expect(commitRes).toEqual({
      status: "failed",
      failureKind: "invalid_format",
    });

    const event = t.db.select().from(generation_events).where(eq(generation_events.event_id, dupEventId)).get();
    expect(event).toMatchObject({
      status: "failed",
      failure_kind: "invalid_format",
      output_text: '{"action":"like","target":"P1","text":null}',
    });

    const attempt = t.db.select().from(generation_attempts).where(eq(generation_attempts.event_id, dupEventId)).get();
    expect(attempt?.error_detail).toMatch(/^duplicate_action likes\.agent_id, likes\.post_id/);
  });

  it("TC-NOUS63_DEV-21 FreeTierExceededError は closeFailed（free_tier）で閉じてから呼び出し元に投げ直す", async () => {
    const llm: LlmClient = {
      async generate() {
        throw new FreeTierExceededError("free tier limit reached", {
          httpStatus: 429,
          detail: "code 3036",
        });
      },
    };

    await expect(runOpportunity(makeCtx(llm))).rejects.toBeInstanceOf(FreeTierExceededError);

    const event = t.db.select().from(generation_events).get();
    expect(event).toMatchObject({
      status: "failed",
      failure_kind: "free_tier",
      finished_at: SEED_NOW,
    });

    const metrics = t.db.select().from(daily_metrics).where(eq(daily_metrics.world_id, worldId)).get();
    expect(metrics).toMatchObject({
      runs: 1,
      failures: 1,
    });
  });

  it("TC-NOUS63_DEV-22 取り消し（ClockCancelledError・LlmCancelledError・signal.aborted）は closeCancelled（cancelled）で閉じる", async () => {
    const llm1: LlmClient = {
      async generate() {
        throw new LlmCancelledError("llm aborted");
      },
    };
    const res1 = await runOpportunity(makeCtx(llm1));
    expect(res1).toMatchObject({
      status: "cancelled",
      failureKind: "cancelled",
    });

    const llm2: LlmClient = {
      async generate() {
        throw new ClockCancelledError("clock aborted");
      },
    };
    const res2 = await runOpportunity(makeCtx(llm2, { cycleNo: 2 }));
    expect(res2).toMatchObject({
      status: "cancelled",
      failureKind: "cancelled",
    });

    const controller = new AbortController();
    controller.abort();
    const llm3: LlmClient = {
      async generate() {
        return makeLlmResult('{"action":"none","target":null,"text":null}');
      },
    };
    const res3 = await runOpportunity(makeCtx(llm3, { cycleNo: 3, signal: controller.signal }));
    expect(res3).toMatchObject({
      status: "cancelled",
      failureKind: "cancelled",
    });

    const metrics = t.db.select().from(daily_metrics).where(eq(daily_metrics.world_id, worldId)).get();
    expect(metrics).toMatchObject({
      runs: 3,
      failures: 0,
    });
  });

  it("TC-NOUS63_DEV-23 StoppedError（再試行待機後の停止）とイベント作成後の AgentNotActiveError は closeCancelled（stopped）で閉じる", async () => {
    let shouldCont = true;
    const llmRetryStop: LlmClient = {
      async generate() {
        throw new RateLimitedError("429", { httpStatus: 429 });
      },
    };

    const promise = runOpportunity(
      makeCtx(llmRetryStop, {
        shouldContinue: () => shouldCont,
      }),
    );
    shouldCont = false;
    await clock.advance(30_000);
    const res1 = await promise;
    expect(res1).toMatchObject({
      status: "cancelled",
      failureKind: "stopped",
    });

    // closeGateNone / closeFailed / closeCancelled 単体呼び出しの確認
    const manualEventId = createEvent(makeCtx(llmRetryStop));
    closeCancelled(manualEventId, "stopped", makeCtx(llmRetryStop));
    const manualEvent = t.db
      .select()
      .from(generation_events)
      .where(eq(generation_events.event_id, manualEventId))
      .get();
    expect(manualEvent).toMatchObject({
      status: "cancelled",
      failure_kind: "stopped",
    });

    const manualFailedId = createEvent(makeCtx(llmRetryStop));
    closeFailed(manualFailedId, "timeout", "last out", makeCtx(llmRetryStop));
    const manualFailed = t.db
      .select()
      .from(generation_events)
      .where(eq(generation_events.event_id, manualFailedId))
      .get();
    expect(manualFailed).toMatchObject({
      status: "failed",
      failure_kind: "timeout",
      output_text: "last out",
    });

    const manualGateId = createEvent(makeCtx(llmRetryStop));
    closeGateNone(manualGateId, makeCtx(llmRetryStop));
    const manualGate = t.db.select().from(generation_events).where(eq(generation_events.event_id, manualGateId)).get();
    expect(manualGate).toMatchObject({
      status: "succeeded",
      action: "none",
      decided_by: "gate",
    });
  });

  it("TC-NOUS63_DEV-24 TemporaryFailureError と想定外の例外は closeFailed で閉じ、想定外の例外も投げ直さない", async () => {
    const llmTimeout: LlmClient = {
      async generate() {
        throw new TimeoutError("timeout 60s");
      },
    };

    const promise = runOpportunity(makeCtx(llmTimeout));
    await clock.advance(30_000);
    await clock.advance(120_000);
    const res1 = await promise;
    expect(res1).toMatchObject({
      status: "failed",
      failureKind: "timeout",
    });

    const llmUnexpected: LlmClient = {
      async generate() {
        throw new TypeError("unexpected internal bug");
      },
    };
    const res2 = await runOpportunity(makeCtx(llmUnexpected, { cycleNo: 2 }));
    expect(res2).toMatchObject({
      status: "failed",
      failureKind: "server_error",
    });
    expect(logLines.some((line) => line.includes("Unexpected error in runOpportunity"))).toBe(true);
  });

  it("TC-NOUS83_DEV-06 runOpportunity は一時的な失敗の再試行待ちの途中で stopSignal が abort されたら時計を進めずに status=cancelled かつ failureKind=stopped で閉じる", async () => {
    const stopController = new AbortController();
    let callCount = 0;
    const llm: LlmClient = {
      async generate() {
        callCount += 1;
        throw new RateLimitedError("429", { httpStatus: 429 });
      },
    };

    const promise = runOpportunity(
      makeCtx(llm, {
        stopSignal: stopController.signal,
      }),
    );

    // 時計を進めずに stopSignal を abort する
    stopController.abort();
    const res = await promise;

    expect(res).toMatchObject({
      status: "cancelled",
      failureKind: "stopped",
      action: null,
      decidedBy: "llm",
    });
    expect(callCount).toBe(1);

    const event = t.db
      .select()
      .from(generation_events)
      .where(eq(generation_events.event_id, res.eventId ?? ""))
      .get();
    expect(event).toMatchObject({
      status: "cancelled",
      failure_kind: "stopped",
    });
  });

  it("TC-NOUS83_DEV-07 runOpportunity は stopSignal が渡されない場合でも従来どおり shouldContinue の停止で stopped で閉じる", async () => {
    let shouldCont = true;
    const llm: LlmClient = {
      async generate() {
        throw new RateLimitedError("429", { httpStatus: 429 });
      },
    };

    const promise = runOpportunity(
      makeCtx(llm, {
        shouldContinue: () => shouldCont,
      }),
    );
    shouldCont = false;
    await clock.advance(30_000);
    const res = await promise;
    expect(res).toMatchObject({
      status: "cancelled",
      failureKind: "stopped",
    });
  });

  it("TC-NOUS83_DEV-08 runOpportunity は LLM 呼び出し中に stopSignal が abort されても中止せず完了して succeeded で閉じる", async () => {
    const stopController = new AbortController();
    const llm: LlmClient = {
      async generate() {
        // LLM 呼び出し中に stopSignal が abort される
        stopController.abort();
        return makeLlmResult('{"action":"post","target":null,"text":"港の風が心地よい朝です。"}');
      },
    };

    const res = await runOpportunity(
      makeCtx(llm, {
        stopSignal: stopController.signal,
      }),
    );

    expect(res).toMatchObject({
      status: "succeeded",
      action: "post",
      failureKind: null,
    });
  });
});
