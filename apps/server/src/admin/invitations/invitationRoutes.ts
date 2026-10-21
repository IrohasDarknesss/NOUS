// 招待のルート 3 本（BE 詳細設計 admin_auth 2章。中身は NOUS-54）
// adminServer が /admin/api に登録する。パスは /admin/api からの相対で書く（例: invitationRoutes.get("/invitations", …)）。
// 認証は adminServer で済んでいる（requireAdminSession・requireCsrf は 掛かっている）
import { Hono } from "hono";
import { loadEnv } from "../../lib/env";
import type { AdminEnv } from "../context";
import {
  issueInvitation,
  issueInvitationBodySchema,
  listInvitationsWithLan,
  revokeInvitation,
} from "./invitationService";
import { getLanAddress } from "./lanAddress";

export const invitationRoutes = new Hono<AdminEnv>();

invitationRoutes.get("/invitations", (c) => {
  const result = listInvitationsWithLan(c.var.db, getLanAddress);
  return c.json(result, 200);
});

invitationRoutes.post("/invitations", async (c) => {
  const body: unknown = await c.req.json().catch(() => ({}));
  const { label } = issueInvitationBodySchema.parse(body);
  const { observerPort } = loadEnv(process.env);
  const result = issueInvitation(
    {
      db: c.var.db,
      clock: c.var.clock,
      admin: c.var.admin,
      observerPort,
      getLanAddress,
    },
    label,
  );
  return c.json(result, 201);
});

invitationRoutes.post("/invitations/:invitationId/revoke", (c) => {
  const invitationId = c.req.param("invitationId");
  const result = revokeInvitation(
    {
      db: c.var.db,
      clock: c.var.clock,
      admin: c.var.admin,
    },
    invitationId,
  );
  return c.json(result, 200);
});
