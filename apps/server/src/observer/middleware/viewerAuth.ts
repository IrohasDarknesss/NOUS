// 招待の Cookie の検証（BE 詳細設計 observer 4章 requireViewer）
import { VIEW_COOKIE_NAME } from "@nous/shared";
import { getCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import type { Db } from "../../db/client";
import { AppError } from "../../lib/errors";
import type { Logger } from "../../lib/logger";
import { maskPath, type ObserverEnv } from "../context";
import { checkInvitation } from "../services/inviteService";

/** Cookie aisns_view の招待が有効でなければ 401 VIEW_NOT_INVITED。有効なら invitationId を入れる */
export function requireViewer(db: Db, logger: Logger) {
  return createMiddleware<ObserverEnv>(async (c, next) => {
    const token = getCookie(c, VIEW_COOKIE_NAME);
    const invitation = token ? checkInvitation(db, token) : null;
    if (!invitation) {
      // トークン（Cookie の値）はログに出さない
      logger.info("observer: 招待のない閲覧を拒否", { path: maskPath(c.req.path), hasCookie: Boolean(token) });
      throw new AppError("VIEW_NOT_INVITED");
    }
    c.set("invitationId", invitation.invitation_id);
    await next();
  });
}
