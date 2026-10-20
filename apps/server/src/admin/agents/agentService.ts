// エージェントの管理操作（BE 詳細設計 admin_data 2章・3章・4章・6章、NOUS-64）
// 準備中の世界でのみ登録・編集・削除を許し、稼働した世界では停止・再開のみを許す。
import {
  AgentInputSchema,
  AgentListQuerySchema,
  type Action,
  type AdminAgentItem,
  type AgentInput,
  type AgentInputRequest,
  type AgentListQuery,
  type AgentListResponse,
  type AgentResumeResponse,
  type AgentSaveResponse,
  type AgentState,
  type AgentStopResponse,
} from "@nous/shared";
import { and, eq, ne, sql } from "drizzle-orm";
import type { Clock } from "../../clock/clock";
import type { Db } from "../../db/client";
import { agents, memories } from "../../db/schema";
import { withTx, type DbOrTx, type Tx } from "../../db/tx";
import { upsertMemory } from "../../generation/memoryUpdater";
import { AppError } from "../../lib/errors";
import { newUlid } from "../../lib/ids";
import { findCurrentWorld, type WorldRow } from "../../world/worldService";
import { recordAudit } from "../audit/auditService";
import { isUniqueViolation, zodFields } from "../middleware/errorHandler";

export type AgentRow = typeof agents.$inferSelect;

/** 操作した管理者（AdminSession のうち監査に使う項目） */
export interface AgentAdmin {
  adminId: string;
}

/** interest_profile の組み立てに使う入力項目 */
export type InterestProfileInput = Pick<AgentInput, "interests" | "topics" | "valuesText">;

/** listAgentsWithStats の1行（snake_case） */
export interface AgentStatsRow {
  agent_id: string;
  handle: string;
  display_name: string;
  state: AgentState;
  activity_level: number;
  post_count: number;
  last_action_at: string | null;
  last_action: Action | null;
}

const INTEREST_PROFILE_MAX_CHARS = 200;

function isSqliteUniqueViolation(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current instanceof Error; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && isUniqueViolation(code)) {
      return true;
    }
    current = current.cause;
  }
  return false;
}

/** SQLite の UNIQUE 違反（ux_agents_world_handle）を 409 HANDLE_TAKEN に変換する（6章） */
export function guardUniqueHandle<T>(fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    if (isSqliteUniqueViolation(err)) {
      throw new AppError("HANDLE_TAKEN", { cause: err });
    }
    throw err;
  }
}

/** 監査の before_json・after_json に残すエージェントの内容 */
function toAuditAgent(
  row: Pick<
    AgentRow,
    | "handle"
    | "display_name"
    | "bio"
    | "interests"
    | "topics"
    | "personality"
    | "values_text"
    | "stance"
    | "activity_level"
    | "state"
  >,
) {
  return {
    handle: row.handle,
    displayName: row.display_name,
    bio: row.bio,
    interests: row.interests,
    topics: row.topics,
    personality: row.personality,
    valuesText: row.values_text,
    stance: row.stance,
    activityLevel: row.activity_level,
    state: row.state,
  };
}

/** interest_profile の1文を 200 字までで組み立てる */
export function interestProfileText(agent: InterestProfileInput): string {
  return `興味：${agent.interests}。関心：${agent.topics}。大事にしていること：${agent.valuesText}`.slice(
    0,
    INTEREST_PROFILE_MAX_CHARS,
  );
}

/**
 * 4章 assertPreparing：世界が preparing でなければ 409 STATE_CONFLICT を投げる
 */
export function assertPreparing(tx: DbOrTx, world: WorldRow | undefined): asserts world is WorldRow {
  void tx;
  if (!world || world.state !== "preparing") {
    throw new AppError("STATE_CONFLICT");
  }
}

/**
 * 4章 buildInterestProfile：「興味：{interests}。関心：{topics}。大事にしていること：{valuesText}」の1文を
 * 200 字までで作り、memories の interest_profile に upsert して、その文字列を返す
 */
export function buildInterestProfile(tx: Tx, agentId: string, agent: InterestProfileInput, nowIso: string): string {
  const content = interestProfileText(agent);
  upsertMemory(tx, agentId, "interest_profile", content, nowIso);
  return content;
}

/** 3章 findAgentInWorld：指定した世界のエージェントを1件読む */
export function findAgentInWorld(db: DbOrTx, worldId: string, agentId: string): AgentRow | undefined {
  return db
    .select()
    .from(agents)
    .where(and(eq(agents.world_id, worldId), eq(agents.agent_id, agentId)))
    .get();
}

/**
 * 3章 listAgentsWithStats：agents を created_at の順に読み、投稿数と最後の生成イベントの開始時刻・action を
 * サブクエリで1回で付ける
 */
export function listAgentsWithStats(db: DbOrTx, worldId: string, state?: AgentState): AgentStatsRow[] {
  const stateCond = state !== undefined ? sql`AND a.state = ${state}` : sql``;
  return db.all<AgentStatsRow>(sql`
    SELECT
      a.agent_id AS agent_id,
      a.handle AS handle,
      a.display_name AS display_name,
      a.state AS state,
      a.activity_level AS activity_level,
      (SELECT count(*) FROM posts p WHERE p.agent_id = a.agent_id) AS post_count,
      (
        SELECT g.started_at
        FROM generation_events g
        WHERE g.agent_id = a.agent_id
        ORDER BY g.started_at DESC, g.event_id DESC
        LIMIT 1
      ) AS last_action_at,
      (
        SELECT g.action
        FROM generation_events g
        WHERE g.agent_id = a.agent_id
        ORDER BY g.started_at DESC, g.event_id DESC
        LIMIT 1
      ) AS last_action
    FROM agents a
    WHERE a.world_id = ${worldId} ${stateCond}
    ORDER BY a.created_at ASC, a.rowid ASC
  `);
}

/** 4章 toAgentListItem：DB の集計行を API 応答の camelCase に変換する */
export function toAgentListItem(row: AgentStatsRow): AdminAgentItem {
  return {
    agentId: row.agent_id,
    handle: row.handle,
    displayName: row.display_name,
    state: row.state,
    activityLevel: row.activity_level,
    postCount: Number(row.post_count),
    lastActionAt: row.last_action_at,
    lastAction: row.last_action,
  };
}

/**
 * 4章 listAgents：現在の世界のエージェントの一覧と worldState を返す
 */
export function listAgents(db: DbOrTx, query: AgentListQuery = {}): AgentListResponse {
  const parsed = AgentListQuerySchema.safeParse(query);
  if (!parsed.success) {
    throw new AppError("VALIDATION_ERROR", { fields: zodFields(parsed.error) });
  }
  const world = findCurrentWorld(db);
  if (!world) {
    return { items: [], worldState: "preparing" };
  }
  const rows = listAgentsWithStats(db, world.world_id, parsed.data.state);
  return {
    items: rows.map(toAgentListItem),
    worldState: world.state,
  };
}

/**
 * 4章 createAgent：準備中の世界にエージェントを登録し、interest_profile と監査を同じトランザクションで記録する
 */
export function createAgent(db: Db, clock: Clock, input: AgentInputRequest, admin: AgentAdmin): AgentSaveResponse {
  const parsed = AgentInputSchema.parse(input);

  return withTx(db, (tx) => {
    const world = findCurrentWorld(tx);
    assertPreparing(tx, world);

    const existing = tx
      .select({ agent_id: agents.agent_id })
      .from(agents)
      .where(and(eq(agents.world_id, world.world_id), eq(agents.handle, parsed.handle)))
      .get();
    if (existing) {
      throw new AppError("HANDLE_TAKEN");
    }

    const agentId = newUlid(clock.nowMs());
    const nowIso = clock.nowIso();

    guardUniqueHandle(() =>
      tx
        .insert(agents)
        .values({
          agent_id: agentId,
          world_id: world.world_id,
          handle: parsed.handle,
          display_name: parsed.displayName,
          bio: parsed.bio,
          interests: parsed.interests,
          topics: parsed.topics,
          personality: parsed.personality,
          values_text: parsed.valuesText,
          stance: parsed.stance,
          activity_level: parsed.activityLevel,
          state: "active",
          created_at: nowIso,
          updated_at: nowIso,
        })
        .run(),
    );

    buildInterestProfile(tx, agentId, parsed, nowIso);

    recordAudit(tx, clock, {
      adminId: admin.adminId,
      operation: "agent.create",
      targetType: "agent",
      targetId: agentId,
      after: {
        handle: parsed.handle,
        displayName: parsed.displayName,
        bio: parsed.bio,
        interests: parsed.interests,
        topics: parsed.topics,
        personality: parsed.personality,
        valuesText: parsed.valuesText,
        stance: parsed.stance,
        activityLevel: parsed.activityLevel,
        state: "active",
      },
      worldId: world.world_id,
    });

    return { agentId };
  });
}

/**
 * 4章 updateAgentProfile：準備中の世界のエージェントを更新し、interest_profile の作り直しと監査を同じトランザクションで行う
 */
export function updateAgentProfile(
  db: Db,
  clock: Clock,
  agentId: string,
  input: AgentInputRequest,
  admin: AgentAdmin,
): AgentSaveResponse {
  const parsed = AgentInputSchema.parse(input);

  return withTx(db, (tx) => {
    const world = findCurrentWorld(tx);
    assertPreparing(tx, world);

    const existing = findAgentInWorld(tx, world.world_id, agentId);
    if (!existing) {
      throw new AppError("AGENT_NOT_FOUND");
    }

    const dup = tx
      .select({ agent_id: agents.agent_id })
      .from(agents)
      .where(and(eq(agents.world_id, world.world_id), eq(agents.handle, parsed.handle), ne(agents.agent_id, agentId)))
      .get();
    if (dup) {
      throw new AppError("HANDLE_TAKEN");
    }

    const nowIso = clock.nowIso();

    guardUniqueHandle(() =>
      tx
        .update(agents)
        .set({
          handle: parsed.handle,
          display_name: parsed.displayName,
          bio: parsed.bio,
          interests: parsed.interests,
          topics: parsed.topics,
          personality: parsed.personality,
          values_text: parsed.valuesText,
          stance: parsed.stance,
          activity_level: parsed.activityLevel,
          updated_at: nowIso,
        })
        .where(eq(agents.agent_id, agentId))
        .run(),
    );

    buildInterestProfile(tx, agentId, parsed, nowIso);

    recordAudit(tx, clock, {
      adminId: admin.adminId,
      operation: "agent.update",
      targetType: "agent",
      targetId: agentId,
      before: toAuditAgent(existing),
      after: {
        handle: parsed.handle,
        displayName: parsed.displayName,
        bio: parsed.bio,
        interests: parsed.interests,
        topics: parsed.topics,
        personality: parsed.personality,
        valuesText: parsed.valuesText,
        stance: parsed.stance,
        activityLevel: parsed.activityLevel,
        state: existing.state,
      },
      worldId: world.world_id,
    });

    return { agentId };
  });
}

/**
 * 4章 deleteAgent：準備中の世界のエージェントと記憶を削除し、監査を同じトランザクションで記録する
 */
export function deleteAgent(db: Db, clock: Clock, agentId: string, admin: AgentAdmin): void {
  withTx(db, (tx) => {
    const world = findCurrentWorld(tx);
    assertPreparing(tx, world);

    const existing = findAgentInWorld(tx, world.world_id, agentId);
    if (!existing) {
      throw new AppError("AGENT_NOT_FOUND");
    }

    tx.delete(memories).where(eq(memories.agent_id, agentId)).run();
    tx.delete(agents).where(eq(agents.agent_id, agentId)).run();

    recordAudit(tx, clock, {
      adminId: admin.adminId,
      operation: "agent.delete",
      targetType: "agent",
      targetId: agentId,
      before: toAuditAgent(existing),
      worldId: world.world_id,
    });
  });
}

/**
 * 4章 stopAgent：稼働した世界のエージェントを停止し、監査を同じトランザクションで記録する
 */
export function stopAgent(db: Db, clock: Clock, agentId: string, admin: AgentAdmin): AgentStopResponse {
  return withTx(db, (tx) => {
    const world = findCurrentWorld(tx);
    if (!world || world.state === "preparing" || world.state === "archived") {
      throw new AppError("STATE_CONFLICT");
    }

    const existing = findAgentInWorld(tx, world.world_id, agentId);
    if (!existing) {
      throw new AppError("AGENT_NOT_FOUND");
    }
    if (existing.state === "stopped") {
      throw new AppError("ALREADY_STOPPED");
    }

    const nowIso = clock.nowIso();
    tx.update(agents).set({ state: "stopped", updated_at: nowIso }).where(eq(agents.agent_id, agentId)).run();

    recordAudit(tx, clock, {
      adminId: admin.adminId,
      operation: "agent.stop",
      targetType: "agent",
      targetId: agentId,
      before: { state: existing.state },
      after: { state: "stopped" },
      worldId: world.world_id,
    });

    return { agentId, state: "stopped" };
  });
}

/**
 * 4章 resumeAgent：停止中のエージェントを稼働に戻し、監査を同じトランザクションで記録する
 */
export function resumeAgent(db: Db, clock: Clock, agentId: string, admin: AgentAdmin): AgentResumeResponse {
  return withTx(db, (tx) => {
    const world = findCurrentWorld(tx);
    if (!world) {
      throw new AppError("AGENT_NOT_FOUND");
    }

    const existing = findAgentInWorld(tx, world.world_id, agentId);
    if (!existing) {
      throw new AppError("AGENT_NOT_FOUND");
    }
    if (existing.state === "active") {
      throw new AppError("ALREADY_ACTIVE");
    }

    const nowIso = clock.nowIso();
    tx.update(agents).set({ state: "active", updated_at: nowIso }).where(eq(agents.agent_id, agentId)).run();

    recordAudit(tx, clock, {
      adminId: admin.adminId,
      operation: "agent.resume",
      targetType: "agent",
      targetId: agentId,
      before: { state: existing.state },
      after: { state: "active" },
      worldId: world.world_id,
    });

    return { agentId, state: "active" };
  });
}
