// 生成ログの参照（BE 詳細設計 admin_data 2章・3章・4章・6章、NOUS-65）
// 読み取りだけ：書き込み・トランザクション・監査はしない（6章「読み取りの API」）。
import {
  EXCERPT_LENGTH,
  GenerationListQuerySchema,
  type Action,
  type DecidedBy,
  type FailureKind,
  type GenerationAttempt,
  type GenerationDetailResponse,
  type GenerationEventDetail,
  type GenerationListQuery,
  type GenerationListResponse,
  type GenerationStatus,
  type RefPost,
} from "@nous/shared";
import { and, asc, count, desc, eq, gte, inArray, lte, sql, type SQL } from "drizzle-orm";
import { agents, generation_attempts, generation_events, posts } from "../../db/schema";
import type { DbOrTx } from "../../db/tx";
import { decodeCursor, encodeCursor } from "../../lib/cursor";
import { AppError } from "../../lib/errors";
import type { Logger } from "../../lib/logger";
import { zodFields } from "../middleware/errorHandler";

export type GenerationRow = typeof generation_events.$inferSelect;

/** listGenerations の1行（snake_case） */
export interface GenerationListRow {
  event_id: string;
  started_at: string;
  world_time_sec: number;
  agent_id: string;
  display_name: string;
  action: Action | null;
  decided_by: DecidedBy;
  status: GenerationStatus;
  failure_kind: FailureKind | null;
  neurons: number;
  consistency_flags: string | null;
}

/** listGenerations の条件（検証済みの値） */
export interface ListGenerationsParams {
  worldId: string;
  agentId?: string;
  action?: Action;
  status?: GenerationStatus;
  /** 開始時刻の下限（ISO 8601。オフセット付きでもよい） */
  from?: string;
  /** 開始時刻の上限（ISO 8601。オフセット付きでもよい） */
  to?: string;
  cursor?: string;
  limit: number;
}

export interface GenerationListPage {
  rows: GenerationListRow[];
  nextCursor: string | null;
}

/** parseJsonColumns の入力（generation_events の JSON の列） */
export type GenerationJsonSource = Pick<
  GenerationRow,
  "event_id" | "input_attributes" | "input_memories" | "input_post_ids" | "action_candidates" | "consistency_flags"
>;

/** JSON の列の解析結果。解析に失敗した列は原文の文字列のまま */
export interface ParsedJsonColumns {
  inputAttributes: GenerationEventDetail["inputAttributes"] | string;
  inputMemories: GenerationEventDetail["inputMemories"] | string;
  inputPostIds: GenerationEventDetail["inputPostIds"] | string;
  actionCandidates: GenerationEventDetail["actionCandidates"] | string;
  consistencyFlags: GenerationEventDetail["consistencyFlags"] | string;
}

const CURSOR_FIELD_MESSAGE = "カーソルが正しくありません";

/**
 * 2つの文字列からなるカーソル（[started_at, event_id]、[world_time_sec, post_id]）を復号する。
 * 形が違えば 400 VALIDATION_ERROR（fields.cursor）
 */
export function decodePairCursor(cursor: string): [string, string] {
  const values = decodeCursor(cursor);
  const [first, second] = values;
  if (values.length !== 2 || first === undefined || second === undefined) {
    throw new AppError("VALIDATION_ERROR", { fields: { cursor: CURSOR_FIELD_MESSAGE } });
  }
  return [first, second];
}

/** 本文の先頭 40 字（サロゲートペアを割らない） */
export function excerptOf(body: string): string {
  return Array.from(body).slice(0, EXCERPT_LENGTH).join("");
}

/**
 * 3章 listGenerations：world_id と任意の条件で generation_events を (started_at, event_id) の新しい順に
 * limit+1 件読み、続きがあれば nextCursor を作る。投稿者の表示名は agents との JOIN で付ける
 */
export function listGenerations(db: DbOrTx, params: ListGenerationsParams): GenerationListPage {
  const conditions: SQL[] = [eq(generation_events.world_id, params.worldId)];
  if (params.agentId !== undefined) conditions.push(eq(generation_events.agent_id, params.agentId));
  if (params.action !== undefined) conditions.push(eq(generation_events.action, params.action));
  if (params.status !== undefined) conditions.push(eq(generation_events.status, params.status));
  // started_at は UTC の ISO 8601（24 字）で保存されているため、オフセット付きの指定は UTC に直して比べる
  if (params.from !== undefined) {
    conditions.push(gte(generation_events.started_at, new Date(params.from).toISOString()));
  }
  if (params.to !== undefined) {
    conditions.push(lte(generation_events.started_at, new Date(params.to).toISOString()));
  }
  if (params.cursor !== undefined) {
    const [startedAt, eventId] = decodePairCursor(params.cursor);
    conditions.push(sql`(${generation_events.started_at}, ${generation_events.event_id}) < (${startedAt}, ${eventId})`);
  }

  const rows = db
    .select({
      event_id: generation_events.event_id,
      started_at: generation_events.started_at,
      world_time_sec: generation_events.world_time_sec,
      agent_id: generation_events.agent_id,
      display_name: agents.display_name,
      action: generation_events.action,
      decided_by: generation_events.decided_by,
      status: generation_events.status,
      failure_kind: generation_events.failure_kind,
      neurons: generation_events.neurons,
      consistency_flags: generation_events.consistency_flags,
    })
    .from(generation_events)
    .innerJoin(agents, eq(agents.agent_id, generation_events.agent_id))
    .where(and(...conditions))
    .orderBy(desc(generation_events.started_at), desc(generation_events.event_id))
    .limit(params.limit + 1)
    .all();

  const hasMore = rows.length > params.limit;
  const page = hasMore ? rows.slice(0, params.limit) : rows;
  const last = page[page.length - 1];
  return {
    rows: page,
    nextCursor: hasMore && last ? encodeCursor([last.started_at, last.event_id]) : null,
  };
}

/**
 * 3章 countAttempts：generation_attempts の数を event_id の IN で1回の GROUP BY で数える。
 * 試行のない event_id は Map に入らない（呼び出し側で 0 として扱う）
 */
export function countAttempts(db: DbOrTx, eventIds: string[]): Map<string, number> {
  if (eventIds.length === 0) {
    return new Map();
  }
  const rows = db
    .select({ event_id: generation_attempts.event_id, n: count() })
    .from(generation_attempts)
    .where(inArray(generation_attempts.event_id, eventIds))
    .groupBy(generation_attempts.event_id)
    .all();
  return new Map(rows.map((row) => [row.event_id, row.n]));
}

/** consistency_flags が NULL でも空配列でもなければ true（JSON として読めない値は「ある」とみなす） */
function hasConsistencyFlags(raw: string | null): boolean {
  if (raw === null) return false;
  try {
    const value: unknown = JSON.parse(raw);
    return !(Array.isArray(value) && value.length === 0);
  } catch {
    return true;
  }
}

/**
 * 4章 listGenerationsForWorld：検証 → listGenerations → countAttempts → 各行に attemptCount・hasConsistencyFlags を付ける
 */
export function listGenerationsForWorld(
  db: DbOrTx,
  worldId: string,
  query: GenerationListQuery,
): GenerationListResponse {
  const parsed = GenerationListQuerySchema.safeParse(query);
  if (!parsed.success) {
    throw new AppError("VALIDATION_ERROR", { fields: zodFields(parsed.error) });
  }

  const page = listGenerations(db, { ...parsed.data, worldId });
  const attempts = countAttempts(
    db,
    page.rows.map((row) => row.event_id),
  );
  return {
    items: page.rows.map((row) => ({
      eventId: row.event_id,
      startedAt: row.started_at,
      worldTimeSec: row.world_time_sec,
      agent: { agentId: row.agent_id, displayName: row.display_name },
      action: row.action,
      decidedBy: row.decided_by,
      status: row.status,
      failureKind: row.failure_kind,
      neurons: row.neurons,
      attemptCount: attempts.get(row.event_id) ?? 0,
      hasConsistencyFlags: hasConsistencyFlags(row.consistency_flags),
    })),
    nextCursor: page.nextCursor,
  };
}

/** JSON の列を1つ解析する。NULL は null、解析に失敗したら原文のまま返して logger.warn（実行 ID 付き） */
function parseJsonColumn<T>(logger: Logger, eventId: string, column: string, raw: string | null): T | string | null {
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    logger.warn("generation_json_parse_failed", { eventId, column });
    return raw;
  }
}

/**
 * 4章 parseJsonColumns：input_attributes・input_memories・input_post_ids・action_candidates・consistency_flags を
 * JSON.parse する。失敗した列は原文の文字列のまま返し、logger.warn に実行 ID を付ける（6章。例外は投げない）
 */
export function parseJsonColumns(logger: Logger, row: GenerationJsonSource): ParsedJsonColumns {
  const eventId = row.event_id;
  return {
    inputAttributes: parseJsonColumn<GenerationEventDetail["inputAttributes"]>(
      logger,
      eventId,
      "input_attributes",
      row.input_attributes,
    ) as ParsedJsonColumns["inputAttributes"],
    inputMemories: parseJsonColumn<GenerationEventDetail["inputMemories"]>(
      logger,
      eventId,
      "input_memories",
      row.input_memories,
    ) as ParsedJsonColumns["inputMemories"],
    inputPostIds: parseJsonColumn<GenerationEventDetail["inputPostIds"]>(
      logger,
      eventId,
      "input_post_ids",
      row.input_post_ids,
    ) as ParsedJsonColumns["inputPostIds"],
    actionCandidates: parseJsonColumn<GenerationEventDetail["actionCandidates"]>(
      logger,
      eventId,
      "action_candidates",
      row.action_candidates,
    ),
    consistencyFlags: parseJsonColumn<GenerationEventDetail["consistencyFlags"]>(
      logger,
      eventId,
      "consistency_flags",
      row.consistency_flags,
    ),
  };
}

/**
 * 4章 getGenerationDetail：世界を問わずに生成イベントを1件読み（アーカイブの世界のものも返す）、
 * attempts（attempt_no の順）・refPosts（input_post_ids の順）・resultPost を付ける。なければ 404 EVENT_NOT_FOUND
 */
export function getGenerationDetail(db: DbOrTx, logger: Logger, eventId: string): GenerationDetailResponse {
  // 1. generation_events を event_id で読む（agents の表示名・ハンドルは JOIN）
  const found = db
    .select({ event: generation_events, handle: agents.handle, display_name: agents.display_name })
    .from(generation_events)
    .innerJoin(agents, eq(agents.agent_id, generation_events.agent_id))
    .where(eq(generation_events.event_id, eventId))
    .get();
  if (!found) {
    throw new AppError("EVENT_NOT_FOUND");
  }
  const { event } = found;

  // 2. generation_attempts を attempt_no の順に読む
  const attempts: GenerationAttempt[] = db
    .select()
    .from(generation_attempts)
    .where(eq(generation_attempts.event_id, eventId))
    .orderBy(asc(generation_attempts.attempt_no))
    .all()
    .map((a) => ({
      attemptNo: a.attempt_no,
      result: a.result,
      httpStatus: a.http_status,
      errorDetail: a.error_detail,
      promptTokens: a.prompt_tokens,
      completionTokens: a.completion_tokens,
      neurons: a.neurons,
      durationMs: a.duration_ms,
    }));

  // 5. JSON の列を解析する
  const json = parseJsonColumns(logger, event);

  // 3. input_post_ids の順に posts を IN で読み、P 番号と先頭 40 字を付ける（投稿の数は上限があるため1回の読み取り）
  const refIds = Array.isArray(json.inputPostIds)
    ? json.inputPostIds.filter((id): id is string => typeof id === "string")
    : [];
  const refBodies = new Map<string, string>(
    refIds.length === 0
      ? []
      : db
          .select({ post_id: posts.post_id, body: posts.body })
          .from(posts)
          .where(inArray(posts.post_id, refIds))
          .all()
          .map((p) => [p.post_id, p.body]),
  );
  // P 番号は入力での位置（input_post_ids の順）。消えた投稿があっても入力の全文の番号とずらさない
  const refPosts: RefPost[] = [];
  refIds.forEach((postId, index) => {
    const body = refBodies.get(postId);
    if (body !== undefined) {
      refPosts.push({ label: `P${index + 1}`, postId, excerpt: excerptOf(body) });
    }
  });

  // 4. post・reply で成功していれば、生成した投稿を generation_event_id で読む
  const produced =
    event.status === "succeeded" && (event.action === "post" || event.action === "reply")
      ? db
          .select({ post_id: posts.post_id, body: posts.body, visibility: posts.visibility })
          .from(posts)
          .where(eq(posts.generation_event_id, eventId))
          .get()
      : undefined;

  return {
    event: {
      eventId: event.event_id,
      worldId: event.world_id,
      agent: { agentId: event.agent_id, displayName: found.display_name, handle: found.handle },
      cycleNo: event.cycle_no,
      cycleSeed: event.cycle_seed,
      status: event.status,
      decidedBy: event.decided_by,
      action: event.action,
      failureKind: event.failure_kind,
      actionCandidates: json.actionCandidates as GenerationEventDetail["actionCandidates"],
      inputAttributes: json.inputAttributes as GenerationEventDetail["inputAttributes"],
      inputMemories: json.inputMemories as GenerationEventDetail["inputMemories"],
      inputPostIds: json.inputPostIds as GenerationEventDetail["inputPostIds"],
      promptText: event.prompt_text,
      outputText: event.output_text,
      modelId: event.model_id,
      promptVersion: event.prompt_version,
      llmMode: event.llm_mode,
      promptTokens: event.prompt_tokens,
      completionTokens: event.completion_tokens,
      neurons: event.neurons,
      costJpy: 0,
      consistencyFlags: json.consistencyFlags as GenerationEventDetail["consistencyFlags"],
      worldTimeSec: event.world_time_sec,
      startedAt: event.started_at,
      finishedAt: event.finished_at,
    },
    attempts,
    refPosts,
    resultPost: produced ? { postId: produced.post_id, body: produced.body, visibility: produced.visibility } : null,
  };
}
