// 管理データのルート 16 本（BE 詳細設計 admin_data 1章・2章。NOUS-64 でエージェントの 6 本を登録、残りは NOUS-65〜NOUS-66）
// adminServer が /admin/api に登録する。パスは /admin/api からの相対で書く（例: dataRoutes.get("/agents", …)）。
// 認証は adminServer で済んでいる（requireAdminSession・requireCsrf は掛かっている）
import { AgentIdParamsSchema, AgentInputSchema, AgentListQuerySchema } from "@nous/shared";
import { Hono, type Context } from "hono";
import { AppError } from "../../lib/errors";
import {
  createAgent,
  deleteAgent,
  listAgents,
  resumeAgent,
  stopAgent,
  updateAgentProfile,
} from "../agents/agentService";
import type { AdminEnv } from "../context";
import { moderationRoutes } from "../moderation/moderationRoutes";

export const dataRoutes = new Hono<AdminEnv>();

async function parseJsonBody(c: Context<AdminEnv>): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new AppError("VALIDATION_ERROR");
  }
}

// 1. GET /admin/api/agents
dataRoutes.get("/agents", (c) => {
  const query = AgentListQuerySchema.parse({ state: c.req.query("state") });
  const res = listAgents(c.var.db, query);
  return c.json(res, 200);
});

// 2. POST /admin/api/agents
dataRoutes.post("/agents", async (c) => {
  const input = AgentInputSchema.parse(await parseJsonBody(c));
  const res = createAgent(c.var.db, c.var.clock, input, c.var.admin);
  return c.json(res, 201);
});

// 3. PUT /admin/api/agents/:agentId
dataRoutes.put("/agents/:agentId", async (c) => {
  const { agentId } = AgentIdParamsSchema.parse({ agentId: c.req.param("agentId") });
  const input = AgentInputSchema.parse(await parseJsonBody(c));
  const res = updateAgentProfile(c.var.db, c.var.clock, agentId, input, c.var.admin);
  return c.json(res, 200);
});

// 4. DELETE /admin/api/agents/:agentId
dataRoutes.delete("/agents/:agentId", (c) => {
  const { agentId } = AgentIdParamsSchema.parse({ agentId: c.req.param("agentId") });
  deleteAgent(c.var.db, c.var.clock, agentId, c.var.admin);
  return c.body(null, 204);
});

// 5. POST /admin/api/agents/:agentId/stop
dataRoutes.post("/agents/:agentId/stop", (c) => {
  const { agentId } = AgentIdParamsSchema.parse({ agentId: c.req.param("agentId") });
  const res = stopAgent(c.var.db, c.var.clock, agentId, c.var.admin);
  return c.json(res, 200);
});

// 6. POST /admin/api/agents/:agentId/resume
dataRoutes.post("/agents/:agentId/resume", (c) => {
  const { agentId } = AgentIdParamsSchema.parse({ agentId: c.req.param("agentId") });
  const res = resumeAgent(c.var.db, c.var.clock, agentId, c.var.admin);
  return c.json(res, 200);
});

dataRoutes.route("/", moderationRoutes);
