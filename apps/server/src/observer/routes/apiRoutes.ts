// /api/*（BE 詳細設計 observer 2章）。観察 API 6 本は NOUS-56 で登録する。ここでは空のルーターを置く
import { Hono } from "hono";
import type { ObserverDeps, ObserverEnv } from "../context";

/** /api に登録するルーター。requireViewer は observerServer で前に通す */
export function createApiRoutes(deps: ObserverDeps): Hono<ObserverEnv> {
  const api = new Hono<ObserverEnv>();
  // NOUS-56 で deps（db・clock・logger）を使って GET /world ほかを登録する
  void deps;
  return api;
}
