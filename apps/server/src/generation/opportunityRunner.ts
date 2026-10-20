// 1 回の行動機会の実行（BE 詳細設計 generation 2章 runOpportunity・4章・6章、
// 行動生成とプロンプトの設計 2章・3章・7章、基本設計書 概要 5章・8章 B05）。
import type { ConsistencyFlag } from "@nous/shared";
import { desc, eq } from "drizzle-orm";
import { utcDate, type Clock } from "../clock/clock";
import type { ActionKind, GenerationConfig } from "../config/generationConfig";
import type { Db } from "../db/client";
import { FAILURE_KINDS, generation_attempts, generation_events, world_settings, worlds } from "../db/schema";
import { withTx } from "../db/tx";
import { newUlid } from "../lib/ids";
import type { Logger } from "../lib/logger";
import { FreeTierExceededError, InvalidFormatError, type LlmClient } from "../llm/llmClient";
import type { UsageLimits } from "../world/limits";
import { getWorldTimeSec, type WorldTimeFields } from "../world/worldTime";
import { applyAction, DuplicateActionError } from "./actionApplier";
import { validateAction, type ValidationContext, type ValidAction } from "./actionValidator";
import { availableActions, createCandidateRng, drawCandidates } from "./candidates";
import { checkConsistency } from "./consistencyChecker";
import { AgentNotActiveError, loadAgent, loadContext, type AgentContext } from "./contextLoader";
import { decideParticipation } from "./gate";
import { updateMemories } from "./memoryUpdater";
import { parseOutput } from "./outputParser";
import { buildPrompt, promptText, type BuiltPrompt } from "./promptBuilder";
import {
  callWithRetry,
  isCancellation,
  StoppedError,
  TemporaryFailureError,
  type TemporaryFailureKind,
} from "./retryPolicy";
import { loadTokenRatio } from "./tokenEstimator";
import { addDailyMetrics, clipErrorDetail, metricsForSucceededAction, recordAttempt } from "./usageRecorder";

export type FailureKind = (typeof FAILURE_KINDS)[number];

export type OpportunityContext = {
  db: Db;
  clock: Clock;
  llm: LlmClient;
  config: GenerationConfig;
  logger: Logger;
  llmMode: "cloudflare" | "fixed";
  worldId: string;
  agentId: string;
  cycleNo: number;
  cycleSeed: number;
  signal: AbortSignal;
  shouldContinue: () => boolean;
  /** テスト用：プロンプトのテンプレートのディレクトリを上書きする */
  promptsDir?: string;
};

export type OpportunityResult = {
  eventId: string | null;
  status: "succeeded" | "failed" | "cancelled" | "skipped";
  action: ActionKind | "none" | null;
  decidedBy: "gate" | "llm" | null;
  neurons: number;
  failureKind: FailureKind | null;
};

export type CreateEventSettings = {
  model_id: string;
  prompt_version: string;
};

export type CloseEventContext = Pick<OpportunityContext, "db" | "worldId" | "clock">;

export type GenerateAndValidateContext = OpportunityContext & {
  agentContext?: AgentContext;
  validationContext?: ValidationContext;
  settings?: {
    model_id: string;
    max_output_tokens: number;
  } & Partial<UsageLimits>;
  handle?: string;
  onOutput?: (text: string) => void;
};

export type CommitActionContext = Pick<
  OpportunityContext,
  "db" | "worldId" | "agentId" | "cycleNo" | "clock" | "config" | "logger"
>;

export type CommitActionResult =
  | { status: "succeeded"; consistencyFlags: ConsistencyFlag[] }
  | { status: "failed"; failureKind: "invalid_format" };

function getEventUsageDate(db: Db, eventId: string, clock: Clock): string {
  const row = db
    .select({ usageDate: generation_events.usage_date })
    .from(generation_events)
    .where(eq(generation_events.event_id, eventId))
    .get();
  return row?.usageDate ?? utcDate(clock.now());
}

function getEventNeurons(db: Db, eventId: string): number {
  const row = db
    .select({ neurons: generation_events.neurons })
    .from(generation_events)
    .where(eq(generation_events.event_id, eventId))
    .get();
  return row?.neurons ?? 0;
}

/**
 * generation_events を status=running・decided_by='llm'（仮）で INSERT する（4章 createEvent）。
 */
export function createEvent(ctx: OpportunityContext, settings?: CreateEventSettings, world?: WorldTimeFields): string {
  const worldRow = world ?? ctx.db.select().from(worlds).where(eq(worlds.world_id, ctx.worldId)).get();
  if (!worldRow) {
    throw new Error(`World not found: ${ctx.worldId}`);
  }

  const settingsRow =
    settings ?? ctx.db.select().from(world_settings).where(eq(world_settings.world_id, ctx.worldId)).get();
  if (!settingsRow) {
    throw new Error(`World settings not found: ${ctx.worldId}`);
  }

  const eventId = newUlid();
  const now = ctx.clock.now();
  const startedAt = ctx.clock.nowIso();
  const usageDate = utcDate(now);
  const worldTimeSec = getWorldTimeSec(worldRow, now);

  ctx.db
    .insert(generation_events)
    .values({
      event_id: eventId,
      world_id: ctx.worldId,
      agent_id: ctx.agentId,
      cycle_no: ctx.cycleNo,
      cycle_seed: ctx.cycleSeed,
      status: "running",
      decided_by: "llm",
      model_id: settingsRow.model_id,
      prompt_version: settingsRow.prompt_version,
      llm_mode: ctx.llmMode,
      world_time_sec: worldTimeSec,
      started_at: startedAt,
      usage_date: usageDate,
    })
    .run();

  return eventId;
}

/**
 * gate で不参加と決まったときに、1 トランザクションで status=succeeded・action=none・decided_by=gate・
 * finished_at を更新し、daily_metrics.nones を +1 する（4章 closeGateNone、行動生成とプロンプトの設計 3章）。
 * LLM は呼ばず、daily_usage にも daily_metrics.runs にも数えない。
 */
export function closeGateNone(eventId: string, ctx: CloseEventContext): void {
  const finishedAt = ctx.clock.nowIso();
  const usageDate = getEventUsageDate(ctx.db, eventId, ctx.clock);

  withTx(ctx.db, (tx) => {
    tx.update(generation_events)
      .set({
        status: "succeeded",
        action: "none",
        decided_by: "gate",
        finished_at: finishedAt,
      })
      .where(eq(generation_events.event_id, eventId))
      .run();

    addDailyMetrics(tx, ctx.worldId, usageDate, { nones: 1 });
  });
}

/**
 * 生成イベントを failed で閉じ、daily_metrics（runs+1・failures+1）を加算する（4章 closeFailed）。
 */
export function closeFailed(
  eventId: string,
  failureKind: FailureKind,
  lastOutput: string | null | undefined,
  ctx: CloseEventContext,
): void {
  const finishedAt = ctx.clock.nowIso();
  const usageDate = getEventUsageDate(ctx.db, eventId, ctx.clock);

  withTx(ctx.db, (tx) => {
    const patch: Partial<typeof generation_events.$inferInsert> = {
      status: "failed",
      failure_kind: failureKind,
      finished_at: finishedAt,
    };
    if (lastOutput !== undefined && lastOutput !== null) {
      patch.output_text = lastOutput;
    }

    tx.update(generation_events).set(patch).where(eq(generation_events.event_id, eventId)).run();

    addDailyMetrics(tx, ctx.worldId, usageDate, { runs: 1, failures: 1 });
  });
}

/**
 * 生成イベントを cancelled で閉じ、daily_metrics（runs+1）を加算する（4章 closeCancelled）。
 */
export function closeCancelled(eventId: string, kind: "cancelled" | "stopped", ctx: CloseEventContext): void {
  const finishedAt = ctx.clock.nowIso();
  const usageDate = getEventUsageDate(ctx.db, eventId, ctx.clock);

  withTx(ctx.db, (tx) => {
    tx.update(generation_events)
      .set({
        status: "cancelled",
        failure_kind: kind,
        finished_at: finishedAt,
      })
      .where(eq(generation_events.event_id, eventId))
      .run();

    addDailyMetrics(tx, ctx.worldId, usageDate, { runs: 1 });
  });
}

/**
 * callWithRetry で LLM を呼び、parseOutput → validateAction で検証する（4章 generateAndValidate）。
 * InvalidFormatError のときは同じ prompt で 1 回だけ再生成し、2 回目も不合格なら InvalidFormatError を投げる。
 */
export async function generateAndValidate(
  eventId: string,
  prompt: BuiltPrompt,
  candidates: readonly ActionKind[],
  ctx: GenerateAndValidateContext,
): Promise<ValidAction> {
  const dbSettings = ctx.db.select().from(world_settings).where(eq(world_settings.world_id, ctx.worldId)).get();

  const modelId = ctx.settings?.model_id ?? dbSettings?.model_id ?? "@cf/google/gemma-4-26b-a4b-it";
  const maxTokens = ctx.settings?.max_output_tokens ?? dbSettings?.max_output_tokens ?? 300;
  const limitsSettings: UsageLimits | undefined =
    dbSettings ??
    (ctx.settings?.daily_neurons_limit !== undefined && ctx.settings?.daily_runs_limit !== undefined
      ? {
          daily_neurons_limit: ctx.settings.daily_neurons_limit,
          daily_runs_limit: ctx.settings.daily_runs_limit,
        }
      : undefined);

  let validationContext = ctx.validationContext;
  let handle = ctx.handle ?? ctx.agentContext?.agent.handle;

  if (!validationContext) {
    const agentCtx =
      ctx.agentContext ??
      loadContext(
        { db: ctx.db, worldId: ctx.worldId, agentId: ctx.agentId },
        { max_ref_posts: dbSettings?.max_ref_posts ?? 12 },
      );
    handle = handle ?? agentCtx.agent.handle;
    validationContext = {
      agentId: ctx.agentId,
      refs: prompt.refs,
      likeablePostIds: agentCtx.likeablePostIds,
      followTargets: agentCtx.followTargets,
      followees: agentCtx.followees,
    };
  }
  if (!handle) {
    const agent = loadAgent(ctx.db, ctx.worldId, ctx.agentId);
    handle = agent.handle;
  }

  let nextAttemptNo = 1;
  const lastFailureKind: TemporaryFailureKind = "server_error";

  for (let genIndex = 0; genIndex < 2; genIndex++) {
    const callRes = await callWithRetry(
      () =>
        ctx.llm.generate({
          modelId,
          messages: prompt.messages,
          maxTokens,
          signal: ctx.signal,
          fixtureKey: {
            handle,
            cycleNo: ctx.cycleNo,
          },
        }),
      {
        db: ctx.db,
        worldId: ctx.worldId,
        eventId,
        clock: ctx.clock,
        signal: ctx.signal,
        shouldContinue: ctx.shouldContinue,
        logger: ctx.logger,
        settings: limitsSettings,
        startAttemptNo: nextAttemptNo,
        lastFailureKind,
      },
    );

    const { attemptNo, startedAt, usageDate, result } = callRes;
    ctx.onOutput?.(result.text);

    try {
      const raw = parseOutput(result.text);
      const valid = validateAction(raw, validationContext, candidates);

      recordAttempt(ctx.db, {
        eventId,
        attemptNo,
        result: "ok",
        httpStatus: result.httpStatus,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        neurons: result.neurons,
        durationMs: result.durationMs,
        startedAt,
        usageDate,
        isFirstOfEvent: attemptNo === 1,
      });

      return valid;
    } catch (err) {
      if (err instanceof InvalidFormatError) {
        // 出力の全文は DB に残し、ログには出さない（6章）
        ctx.logger.warn("LLM output validation failed", {
          eventId,
          attemptNo,
          detail: err.detail,
        });

        recordAttempt(ctx.db, {
          eventId,
          attemptNo,
          result: "invalid_format",
          httpStatus: result.httpStatus,
          errorDetail: err.detail,
          durationMs: result.durationMs,
          startedAt,
          usageDate,
          isFirstOfEvent: attemptNo === 1,
        });

        if (genIndex === 0) {
          nextAttemptNo = attemptNo + 1;
          continue;
        }
      }
      throw err;
    }
  }

  throw new InvalidFormatError("Invalid format after regeneration");
}

/**
 * 1 トランザクションで applyAction → updateMemories → checkConsistency →
 * generation_events の succeeded 更新 → addDailyMetrics を行う（4章 commitAction・6章）。
 * DuplicateActionError のときはロールバックの後、別のトランザクションで closeFailed（invalid_format）し、
 * 最後の試行の generation_attempts.error_detail に DuplicateActionError の errorDetail を書く。
 */
export function commitAction(
  eventId: string,
  action: ValidAction,
  context: Pick<AgentContext, "agent">,
  outputText: string | null,
  ctx: CommitActionContext,
): CommitActionResult {
  const eventRow = ctx.db
    .select({
      worldTimeSec: generation_events.world_time_sec,
      usageDate: generation_events.usage_date,
    })
    .from(generation_events)
    .where(eq(generation_events.event_id, eventId))
    .get();

  const worldTimeSec = eventRow?.worldTimeSec ?? 0;
  const usageDate = eventRow?.usageDate ?? utcDate(ctx.clock.now());

  try {
    const consistencyFlags = withTx(ctx.db, (tx) => {
      const nowIso = ctx.clock.nowIso();

      applyAction(tx, eventId, action, {
        worldId: ctx.worldId,
        agentId: ctx.agentId,
        worldTimeSec,
        nowIso,
        usageDate,
      });

      updateMemories(tx, ctx.agentId, action, nowIso);

      const flags = checkConsistency(
        tx,
        action,
        {
          worldId: ctx.worldId,
          agentId: ctx.agentId,
          eventId,
          cycleNo: ctx.cycleNo,
          personality: context.agent.personality,
        },
        ctx.config,
      );

      tx.update(generation_events)
        .set({
          status: "succeeded",
          action: action.action,
          decided_by: "llm",
          output_text: outputText,
          consistency_flags: JSON.stringify(flags),
          finished_at: nowIso,
        })
        .where(eq(generation_events.event_id, eventId))
        .run();

      addDailyMetrics(tx, ctx.worldId, usageDate, metricsForSucceededAction(action.action));

      return flags;
    });

    return { status: "succeeded", consistencyFlags };
  } catch (err) {
    if (err instanceof DuplicateActionError) {
      ctx.logger.error("Duplicate action detected during commitAction", {
        eventId,
        constraint: err.constraint,
        errorDetail: err.errorDetail,
      });

      withTx(ctx.db, (tx) => {
        const finishedAt = ctx.clock.nowIso();
        const patch: Partial<typeof generation_events.$inferInsert> = {
          status: "failed",
          failure_kind: "invalid_format",
          finished_at: finishedAt,
        };
        if (outputText !== null) {
          patch.output_text = outputText;
        }
        tx.update(generation_events).set(patch).where(eq(generation_events.event_id, eventId)).run();

        addDailyMetrics(tx, ctx.worldId, usageDate, { runs: 1, failures: 1 });

        const lastAttempt = tx
          .select({ attempt_id: generation_attempts.attempt_id })
          .from(generation_attempts)
          .where(eq(generation_attempts.event_id, eventId))
          .orderBy(desc(generation_attempts.attempt_no))
          .limit(1)
          .get();

        if (lastAttempt) {
          tx.update(generation_attempts)
            .set({ error_detail: clipErrorDetail(err.errorDetail) })
            .where(eq(generation_attempts.attempt_id, lastAttempt.attempt_id))
            .run();
        }
      });

      return { status: "failed", failureKind: "invalid_format" };
    }
    throw err;
  }
}

/**
 * 1 体のエージェントの 1 回の行動機会を実行する（2章・4章 runOpportunity・6章）。
 */
export async function runOpportunity(ctx: OpportunityContext): Promise<OpportunityResult> {
  const world = ctx.db.select().from(worlds).where(eq(worlds.world_id, ctx.worldId)).get();
  if (!world) {
    throw new Error(`World not found: ${ctx.worldId}`);
  }
  const settings = ctx.db.select().from(world_settings).where(eq(world_settings.world_id, ctx.worldId)).get();
  if (!settings) {
    throw new Error(`World settings not found: ${ctx.worldId}`);
  }

  let agent;
  try {
    agent = loadAgent(ctx.db, ctx.worldId, ctx.agentId);
  } catch (err) {
    if (err instanceof AgentNotActiveError) {
      ctx.logger.info("Skipping opportunity because agent is not active", {
        worldId: ctx.worldId,
        agentId: ctx.agentId,
        cycleNo: ctx.cycleNo,
      });
      return {
        eventId: null,
        status: "skipped",
        action: null,
        decidedBy: null,
        neurons: 0,
        failureKind: null,
      };
    }
    throw err;
  }

  const eventId = createEvent(ctx, settings, world);
  let lastOutput: string | null = null;

  try {
    const participates = decideParticipation(agent, ctx.cycleSeed, ctx.config);
    if (!participates) {
      closeGateNone(eventId, ctx);
      return {
        eventId,
        status: "succeeded",
        action: "none",
        decidedBy: "gate",
        neurons: 0,
        failureKind: null,
      };
    }

    const context = loadContext({ db: ctx.db, worldId: ctx.worldId, agentId: ctx.agentId }, settings);
    const available = availableActions(context.refs, context.likeablePostIds, context.followTargets, context.followees);
    const candidateRng = createCandidateRng(ctx.cycleSeed, ctx.agentId);
    const candidates = drawCandidates(candidateRng, available, context.recentActions, ctx.config);
    const ratio = loadTokenRatio(ctx.db);
    const builtPrompt = buildPrompt(
      context,
      candidates,
      settings,
      ratio,
      ctx.promptsDir !== undefined ? { promptsDir: ctx.promptsDir } : {},
    );

    // 失敗で閉じたときにも入力をたどれるように、LLM を呼ぶ前に記録する
    ctx.db
      .update(generation_events)
      .set({
        action_candidates: JSON.stringify(candidates),
        prompt_text: promptText(builtPrompt.messages),
        input_attributes: JSON.stringify(builtPrompt.usedAttributes),
        input_memories: JSON.stringify(builtPrompt.usedMemories),
        input_post_ids: JSON.stringify(builtPrompt.refs.map((r) => r.postId)),
      })
      .where(eq(generation_events.event_id, eventId))
      .run();

    const validAction = await generateAndValidate(eventId, builtPrompt, candidates, {
      ...ctx,
      agentContext: context,
      settings,
      onOutput: (text) => {
        lastOutput = text;
      },
    });

    const committed = commitAction(eventId, validAction, context, lastOutput, ctx);
    const neurons = getEventNeurons(ctx.db, eventId);

    if (committed.status === "failed") {
      return {
        eventId,
        status: "failed",
        action: null,
        decidedBy: "llm",
        neurons,
        failureKind: committed.failureKind,
      };
    }

    return {
      eventId,
      status: "succeeded",
      action: validAction.action,
      decidedBy: "llm",
      neurons,
      failureKind: null,
    };
  } catch (err) {
    const neurons = getEventNeurons(ctx.db, eventId);

    if (err instanceof FreeTierExceededError) {
      ctx.logger.warn("Free tier exceeded during runOpportunity", { eventId });
      closeFailed(eventId, "free_tier", lastOutput, ctx);
      throw err;
    }

    if (isCancellation(err, ctx.signal)) {
      ctx.logger.info("runOpportunity cancelled", { eventId });
      closeCancelled(eventId, "cancelled", ctx);
      return {
        eventId,
        status: "cancelled",
        action: null,
        decidedBy: "llm",
        neurons,
        failureKind: "cancelled",
      };
    }

    if (err instanceof StoppedError) {
      ctx.logger.info("runOpportunity stopped while waiting for retry", { eventId });
      closeCancelled(eventId, "stopped", ctx);
      return {
        eventId,
        status: "cancelled",
        action: null,
        decidedBy: "llm",
        neurons,
        failureKind: "stopped",
      };
    }

    if (err instanceof AgentNotActiveError) {
      ctx.logger.info("Agent became inactive after event creation", {
        eventId,
        agentId: ctx.agentId,
      });
      closeCancelled(eventId, "stopped", ctx);
      return {
        eventId,
        status: "cancelled",
        action: null,
        decidedBy: "llm",
        neurons,
        failureKind: "stopped",
      };
    }

    if (err instanceof TemporaryFailureError) {
      closeFailed(eventId, err.failureKind, lastOutput, ctx);
      return {
        eventId,
        status: "failed",
        action: null,
        decidedBy: "llm",
        neurons,
        failureKind: err.failureKind,
      };
    }

    if (err instanceof InvalidFormatError) {
      closeFailed(eventId, "invalid_format", lastOutput, ctx);
      return {
        eventId,
        status: "failed",
        action: null,
        decidedBy: "llm",
        neurons,
        failureKind: "invalid_format",
      };
    }

    ctx.logger.error("Unexpected error in runOpportunity", {
      eventId,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    closeFailed(eventId, "server_error", lastOutput, ctx);
    return {
      eventId,
      status: "failed",
      action: null,
      decidedBy: "llm",
      neurons,
      failureKind: "server_error",
    };
  }
}
