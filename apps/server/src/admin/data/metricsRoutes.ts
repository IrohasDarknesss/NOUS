// 日別の指標のルート（BE 詳細設計 admin_data 2章、NOUS-65）
// 読み取りだけ：DB を書き換えない。監査ログも残さない。
import { MetricsQuerySchema } from "@nous/shared";
import { Hono } from "hono";
import type { AdminEnv } from "../context";
import { getDailyMetricsView } from "../metrics/metricsService";

export const metricsRoutes = new Hono<AdminEnv>();

// 13. GET /admin/api/metrics/daily
metricsRoutes.get("/metrics/daily", (c) => {
  const query = MetricsQuerySchema.parse({
    from: c.req.query("from"),
    to: c.req.query("to"),
  });
  const res = getDailyMetricsView(c.var.db, c.var.clock, query);
  return c.json(res, 200);
});
