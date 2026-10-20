// 観察サーバーで共有する型と小さな関数（BE 詳細設計 observer 1章）
import type { HttpBindings } from "@hono/node-server";
import type { Clock } from "../clock/clock";
import type { Db } from "../db/client";
import type { Logger } from "../lib/logger";

/** Hono の環境。Bindings は @hono/node-server の incoming（送信元のアドレス）、Variables は requireViewer が入れる招待 ID */
export interface ObserverEnv {
  Bindings: HttpBindings;
  Variables: { invitationId: string };
}

/** 観察サーバーのルートとサービスに渡す依存 */
export interface ObserverDeps {
  db: Db;
  clock: Clock;
  logger: Logger;
}

/** ログに出すパス。/invite/:token のトークンは伏せる（observer 6章「トークンは出さない」） */
export function maskPath(path: string): string {
  return path.startsWith("/invite/") ? "/invite/***" : path;
}
