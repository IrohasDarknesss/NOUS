// プロセスの起動と終了（BE 詳細設計 world 1章・4章・5章・6章、基本設計書 概要 1章・9章・10章）
// 起動の順：B07 recoverOnStartup → B06 runBackup → 両サーバー（startObserverServer・startAdminServer）→ Scheduler
import { pathToFileURL } from "node:url";
import type { ServerType } from "@hono/node-server";
import { startAdminServer, type StartAdminServerOptions } from "./admin/adminServer";
import type { AdminDeps } from "./admin/context";
import { createClock, type Clock } from "./clock/clock";
import { closeDb, openDb, type Db } from "./db/client";
import { runMigrations } from "./db/migrate";
import { withTx } from "./db/tx";
import { loadEnv, type AppEnv } from "./lib/env";
import { createLogger, type Logger } from "./lib/logger";
import { startObserverServer, type StartObserverServerOptions } from "./observer/observerServer";
import { runBackup } from "./scheduler/backup";
import { scheduleDayRollover } from "./scheduler/dayRollover";
import { scheduleHeartbeat } from "./scheduler/heartbeat";
import { recoverOnStartup } from "./scheduler/startupRecovery";
import { configureWorldApi } from "./world/worldRoutes";
import { createInitialWorld, findCurrentWorld, type SchedulerControl } from "./world/worldService";

/**
 * アプリケーション全体の Scheduler のインタフェース。
 * TODO(NOUS-59): scheduler/scheduler.ts の実装後にその型と実装をつなぐ
 */
export interface AppScheduler extends SchedulerControl {
  start(): void;
  stop(): Promise<void>;
}

export type ServerHandle = ServerType | { close(): void | Promise<void> };

export interface StartAppOptions {
  env?: AppEnv;
  clock?: Clock;
  db?: Db;
  logger?: Logger;
  createScheduler?: (ctx: { db: Db; clock: Clock; logger: Logger }) => AppScheduler;
  startObserver?: (db: Db, clock: Clock, port: number, options?: StartObserverServerOptions) => ServerHandle;
  startAdmin?: (deps: AdminDeps, port: number, options?: StartAdminServerOptions) => ServerHandle;
  recover?: typeof recoverOnStartup;
  backup?: typeof runBackup;
}

export interface RunningApp {
  db: Db;
  clock: Clock;
  logger: Logger;
  scheduler: AppScheduler;
  close(): Promise<void>;
}

/**
 * NOUS-59 までの仮の Scheduler スタブ。
 * TODO(NOUS-59): scheduler/scheduler.ts ができたら本物の Scheduler に置き換える
 */
function createStubScheduler(logger: Logger): AppScheduler {
  return {
    start(): void {
      logger.warn("Scheduler は NOUS-59 で実装");
    },
    async stop(): Promise<void> {},
    async stopAll(): Promise<number> {
      return 0;
    },
    wake(): void {},
  };
}

function isNodeServer(handle: ServerHandle): handle is ServerType {
  return typeof (handle as { listen?: unknown }).listen === "function";
}

async function closeServerHandle(handle: ServerHandle): Promise<void> {
  if (isNodeServer(handle)) {
    await new Promise<void>((resolve, reject) => {
      handle.close((err) => (err ? reject(err) : resolve()));
    });
    return;
  }
  await handle.close();
}

/**
 * サーバー・スケジューラー・日次タイマーを決められた順で起動する（world 1章）。
 * 1. loadEnv、createLogger、createClock、openDb、runMigrations
 * 2. 現在の世界がなければ createInitialWorld（初回の起動）
 * 3. B07 recoverOnStartup（失敗したら起動を止める）
 * 4. B06 runBackup（失敗しても error を記録して起動を続ける）
 * 5. Scheduler を用意し、configureWorldApi で管理 API に渡す
 * 6. 観察サーバーと管理サーバーを起動
 * 7. B08（scheduleHeartbeat）と B02（scheduleDayRollover）を張り、scheduler.start()
 */
export async function startApp(options: StartAppOptions = {}): Promise<RunningApp> {
  const env = options.env ?? loadEnv();
  const clock = options.clock ?? createClock({ NODE_ENV: env.nodeEnv, AISNS_CLOCK: env.clock });
  const logger = options.logger ?? createLogger({ level: env.logLevel, now: () => clock.now() });
  const db = options.db ?? openDb(env.dbPath);

  try {
    runMigrations(db);

    withTx(db, (tx) => {
      if (!findCurrentWorld(tx)) {
        createInitialWorld(tx, clock.now());
      }
    });

    const recover = options.recover ?? recoverOnStartup;
    recover({ db, clock, logger }, clock.now());

    const backup = options.backup ?? runBackup;
    try {
      backup({ db, backupDir: env.backupDir, logger }, clock.now());
    } catch (err) {
      logger.error("起動時のバックアップに失敗しました", { err });
    }

    // Scheduler は管理 API（世界の操作）が使うので、サーバーより前に用意して configureWorldApi に渡す。
    // 動かし始める（start）のは両サーバーの後
    // TODO(NOUS-59): scheduler/scheduler.ts の実装後に既定の Scheduler をつなぐ
    const scheduler = options.createScheduler
      ? options.createScheduler({ db, clock, logger })
      : createStubScheduler(logger);
    configureWorldApi({ scheduler });

    const startObserver = options.startObserver ?? startObserverServer;
    const startAdmin = options.startAdmin ?? startAdminServer;
    const observerServer = startObserver(db, clock, env.observerPort, { logger });
    const adminServer = startAdmin({ db, clock, logger }, env.adminPort);

    // TODO(NOUS-59): 設計（world 4章 Scheduler.start）では Scheduler.start が B08・B02 のタイマーを張るので、NOUS-59 で Scheduler に移すか整理する
    const stopHeartbeat = scheduleHeartbeat({ db, clock, scheduler, logger });
    const stopDayRollover = scheduleDayRollover({
      db,
      clock,
      scheduler,
      backupDir: env.backupDir,
      logger,
    });
    scheduler.start();

    let closed = false;
    return {
      db,
      clock,
      logger,
      scheduler,
      close: async () => {
        if (closed) return;
        closed = true;
        stopHeartbeat();
        stopDayRollover();
        await scheduler.stop();
        await closeServerHandle(adminServer);
        await closeServerHandle(observerServer);
        closeDb(db);
      },
    };
  } catch (err) {
    if (!options.db) {
      closeDb(db);
    }
    throw err;
  }
}

const isMainModule = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  startApp()
    .then((app) => {
      let shuttingDown = false;
      const shutdown = (signal: NodeJS.Signals): void => {
        if (shuttingDown) return;
        shuttingDown = true;
        app.logger.info("終了シグナルを受け取りました", { signal });
        app.close().catch((err: unknown) => {
          app.logger.error("終了処理に失敗しました", { err });
          process.exitCode = 1;
        });
      };
      process.once("SIGINT", () => shutdown("SIGINT"));
      process.once("SIGTERM", () => shutdown("SIGTERM"));
    })
    .catch((err: unknown) => {
      const logger = createLogger();
      logger.error("起動に失敗しました", { err });
      process.exitCode = 1;
    });
}
