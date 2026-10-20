// GET /invite/:token（BE 詳細設計 observer 2章、4章 inviteHandler）
import { VIEW_COOKIE_MAX_AGE_SEC, VIEW_COOKIE_NAME } from "@nous/shared";
import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import type { ObserverDeps, ObserverEnv } from "../context";
import { acceptInvite } from "../services/inviteService";

/** 照合に成功したときの移動先と、失敗したときの移動先（P106） */
export const INVITE_SUCCESS_LOCATION = "/";
export const INVITE_FAILURE_LOCATION = "/not-invited";

/** /invite に登録するルーター（/:token） */
export function createInviteRoutes({ db, clock, logger }: ObserverDeps): Hono<ObserverEnv> {
  const routes = new Hono<ObserverEnv>();
  routes.get("/:token", (c) => {
    const token = c.req.param("token");
    const { ok } = acceptInvite(db, token, clock.nowIso(), logger);
    if (!ok) {
      // トークンはログに出さない
      logger.info("observer: 招待リンクの照合に失敗");
      return c.redirect(INVITE_FAILURE_LOCATION, 302);
    }
    setCookie(c, VIEW_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
      maxAge: VIEW_COOKIE_MAX_AGE_SEC,
    });
    return c.redirect(INVITE_SUCCESS_LOCATION, 302);
  });
  return routes;
}
