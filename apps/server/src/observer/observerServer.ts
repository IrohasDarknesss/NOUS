// 観察サーバーの組み立てと起動（BE 詳細設計 observer 1章・2章・4章 startObserverServer・6章）
import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { serve, type ServerType } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import type { Clock } from "../clock/clock";
import type { Db } from "../db/client";
import { AppError, isAppError } from "../lib/errors";
import { createLogger, type Logger } from "../lib/logger";
import { maskPath, type ObserverDeps, type ObserverEnv } from "./context";
import { privateNetworkOnly } from "./middleware/privateNetworkOnly";
import { ALLOWED_METHODS, readOnly } from "./middleware/readOnly";
import { applySecurityHeaders, securityHeaders } from "./middleware/securityHeaders";
import { requireViewer } from "./middleware/viewerAuth";
import { createApiRoutes } from "./routes/apiRoutes";
import { createInviteRoutes } from "./routes/inviteRoutes";

/** 待ち受けのアドレス（IPv4 だけ。同じネットワークの中から閲覧させる） */
export const OBSERVER_HOSTNAME = "0.0.0.0";

/** 観察画面のビルドの置き場所（apps/observer/dist） */
export const DEFAULT_OBSERVER_DIST = fileURLToPath(new URL("../../../observer/dist", import.meta.url));

export interface ObserverAppOptions {
  /** 画面の静的ファイルの置き場所（絶対パス）。null なら配らない（API だけのテスト）。既定は apps/observer/dist */
  staticDir?: string | null;
}

/**
 * 観察サーバーの Hono のアプリを組み立てる。
 * すべての要求が privateNetworkOnly → readOnly → securityHeaders を通る。
 * /invite と画面の静的ファイル（/not-invited を含む）以外、つまり /api/* は requireViewer を通る
 */
export function createObserverApp(deps: ObserverDeps, options: ObserverAppOptions = {}): Hono<ObserverEnv> {
  const { db, logger } = deps;
  const app = new Hono<ObserverEnv>();

  app.use("*", privateNetworkOnly(logger));
  app.use("*", readOnly(logger));
  app.use("*", securityHeaders());

  app.route("/invite", createInviteRoutes(deps));
  app.use("/api/*", requireViewer(db, logger));
  app.route("/api", createApiRoutes(deps));

  const staticDir = options.staticDir === undefined ? DEFAULT_OBSERVER_DIST : options.staticDir;
  if (staticDir !== null) {
    if (existsSync(staticDir)) {
      // @hono/node-server の serveStatic は root をカレントからの相対パスで受ける
      const root = relative(process.cwd(), staticDir);
      app.use("*", serveStatic({ root }));
      // 未知のパスは index.html を返す（SPA。/not-invited もここで画面が開く）。/api/* は除く
      const spaIndex = serveStatic({ path: join(root, "index.html") });
      app.get("*", async (c, next) => (c.req.path.startsWith("/api/") ? next() : spaIndex(c, next)));
    } else {
      logger.warn("observer: 画面のビルドが見つからないため、静的ファイルを配りません", { staticDir });
    }
  }

  app.notFound((c) => c.text("Not Found", 404));

  // 想定外の例外は 500 INTERNAL_ERROR（admin_auth の errorHandler と同じ形の JSON）。
  // privateNetworkOnly・readOnly で止めた応答は securityHeaders を通らないので、ここでもヘッダーを付ける
  app.onError((err, c) => {
    applySecurityHeaders(c);
    if (isAppError(err)) {
      if (err.code === "WRITE_NOT_ALLOWED") c.header("Allow", ALLOWED_METHODS);
      return c.json(err.toBody(), err.status);
    }
    logger.error("observer: 想定外の例外", { err, method: c.req.method, path: maskPath(c.req.path) });
    const internal = new AppError("INTERNAL_ERROR");
    return c.json(internal.toBody(), internal.status);
  });

  return app;
}

export interface StartObserverServerOptions extends ObserverAppOptions {
  logger?: Logger;
}

/** 観察サーバーを 0.0.0.0:port（既定 8080）で起動する */
export function startObserverServer(
  db: Db,
  clock: Clock,
  port: number,
  options: StartObserverServerOptions = {},
): ServerType {
  const logger = (options.logger ?? createLogger()).child({ module: "observer" });
  const app = createObserverApp({ db, clock, logger }, options);
  return serve({ fetch: app.fetch, hostname: OBSERVER_HOSTNAME, port }, (info) => {
    logger.info("observer: 起動", { address: info.address, port: info.port });
  });
}
