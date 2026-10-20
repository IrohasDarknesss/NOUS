// 管理サーバーの組み立てと起動（BE 詳細設計 admin_auth 1章・4章 startAdminServer・assertLocalBind、5章、6章、NFR-S-007）
// 127.0.0.1 だけで待ち受ける。/admin/api 以下は requireAdminSession と requireCsrf を通し、画面の静的ファイルを配る
import { existsSync } from "node:fs";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";
import { serve, type ServerType } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono, type MiddlewareHandler } from "hono";
import { worldRoutes } from "../world/worldRoutes";
import { settingsRoutes } from "../world/settingsRoutes";
import { auditRoutes } from "./audit/auditRoutes";
import { authRoutes } from "./auth/authRoutes";
import type { AdminDeps, AdminEnv } from "./context";
import { dataRoutes } from "./data/routes";
import { invitationRoutes } from "./invitations/invitationRoutes";
import { requireCsrf } from "./middleware/csrf";
import { errorHandler } from "./middleware/errorHandler";
import { deleteExpiredSessions, requireAdminSession } from "./middleware/sessionAuth";

/** 管理サーバーが待ち受けるアドレス。これ以外は起動しない */
export const ADMIN_HOST = "127.0.0.1";
export const ADMIN_API_PREFIX = "/admin/api";
/** 期限切れのセッションを消す間隔（5章。起動時と 60 分ごと） */
export const SESSION_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/** 管理画面のビルドの出力（apps/admin/dist） */
const ADMIN_DIST = fileURLToPath(new URL("../../../admin/dist/", import.meta.url));

/** requireAdminSession・requireCsrf を通さない要求（login はセッションがまだない。GET /session は authRoutes で検証する） */
export const PUBLIC_ROUTES: ReadonlyArray<{ method: string; path: string }> = [
  { method: "POST", path: `${ADMIN_API_PREFIX}/login` },
  { method: "GET", path: `${ADMIN_API_PREFIX}/session` },
  { method: "HEAD", path: `${ADMIN_API_PREFIX}/session` },
];

export class AdminBindError extends Error {
  constructor(host: string) {
    super(`管理サーバーは ${ADMIN_HOST} だけで待ち受けます（指定: ${host}）`);
    this.name = "AdminBindError";
  }
}

/** host が 127.0.0.1 でなければ AdminBindError */
export function assertLocalBind(host: string): void {
  if (host !== ADMIN_HOST) {
    throw new AdminBindError(host);
  }
}

const isPublic = (method: string, path: string): boolean =>
  PUBLIC_ROUTES.some((r) => r.method === method && r.path === path.replace(/\/+$/, ""));

/** /admin/api 以下の要求に requireAdminSession → requireCsrf を掛ける（PUBLIC_ROUTES を除く） */
const adminApiGuard: MiddlewareHandler<AdminEnv> = async (c, next) => {
  if (isPublic(c.req.method, c.req.path)) {
    await next();
    return;
  }
  await requireAdminSession(c, async () => {
    await requireCsrf(c, next);
  });
};

export interface AdminAppOptions {
  /** 画面の静的ファイルの置き場所（既定は apps/admin/dist）。null で配らない（テスト用） */
  staticDir?: string | null;
}

/** 管理サーバーの Hono のアプリを組み立てる（listen はしない。テストは app.request で叩く） */
export function createAdminApp(deps: AdminDeps, options: AdminAppOptions = {}): Hono<AdminEnv> {
  const app = new Hono<AdminEnv>();
  app.onError(errorHandler);
  app.use("*", async (c, next) => {
    c.set("db", deps.db);
    c.set("clock", deps.clock);
    c.set("logger", deps.logger);
    await next();
  });

  app.use(`${ADMIN_API_PREFIX}/*`, adminApiGuard);
  for (const routes of [authRoutes, invitationRoutes, auditRoutes, worldRoutes, settingsRoutes, dataRoutes]) {
    app.route(ADMIN_API_PREFIX, routes);
  }

  const staticDir = options.staticDir === undefined ? ADMIN_DIST : options.staticDir;
  if (staticDir && existsSync(staticDir)) {
    // serveStatic の root は作業ディレクトリからの相対で渡す
    const root = relative(process.cwd(), staticDir) || ".";
    app.use("*", serveStatic({ root }));
    // 画面の URL（/agents など）の再読み込みは index.html を返す。/admin/api 以下は返さない
    app.get("*", async (c, next) => {
      if (c.req.path.startsWith(ADMIN_API_PREFIX)) {
        await next();
        return;
      }
      return serveStatic({ root, path: "index.html" })(c, next);
    });
  }
  return app;
}

export interface StartAdminServerOptions extends AdminAppOptions {
  /** 待ち受けのアドレス。127.0.0.1 以外を渡すと起動しない（既定は 127.0.0.1） */
  host?: string;
}

export interface AdminServer {
  server: ServerType;
  app: Hono<AdminEnv>;
  /** 待ち受けとセッションの定期の削除を止める */
  close(): Promise<void>;
}

/**
 * 管理サーバーを 127.0.0.1:port で起動する。起動時と 60 分ごとに期限切れのセッションを消す。
 * 127.0.0.1 以外のアドレスが渡されたら、listen の前に AdminBindError で止める
 */
export function startAdminServer(deps: AdminDeps, port: number, options: StartAdminServerOptions = {}): AdminServer {
  const host = options.host ?? ADMIN_HOST;
  assertLocalBind(host);

  const app = createAdminApp(deps, options);
  const sweep = (): void => {
    try {
      const deleted = deleteExpiredSessions(deps.db, deps.clock);
      if (deleted > 0) deps.logger.info("admin_sessions_swept", { deleted });
    } catch (err) {
      deps.logger.error("admin_sessions_sweep_failed", { err });
    }
  };
  sweep();
  const cancelSweep = deps.clock.setRepeatingTimer(SESSION_SWEEP_INTERVAL_MS, sweep);

  const server = serve({ fetch: app.fetch, port, hostname: host }, (info) => {
    deps.logger.info("admin_server_listening", { host, port: info.port });
  });

  return {
    server,
    app,
    close: () =>
      new Promise<void>((resolve, reject) => {
        cancelSweep();
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
