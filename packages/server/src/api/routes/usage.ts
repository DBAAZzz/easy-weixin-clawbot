import type { Hono } from "hono";
import { getUsageOverview } from "../../db/usage.js";

export function registerUsageRoutes(app: Hono) {
  // window 首版固定（活跃近一年、token 近 30 天）；accountId 缺省则聚合全部账号。
  app.get("/api/usage/overview", async (c) => {
    const accountId = c.req.query("accountId") || undefined;
    return c.json({ data: await getUsageOverview(accountId) });
  });
}
