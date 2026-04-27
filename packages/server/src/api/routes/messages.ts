import type { Hono } from "hono";
import { listMessages } from "../../db/messages.js";

export function registerMessageRoutes(app: Hono) {
  app.get("/api/accounts/:accountId/conversations/:conversationId/messages", async (c) => {
    const limitParam = Number.parseInt(c.req.query("limit") ?? "20", 10);
    const beforeParam = c.req.query("before");
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 100) : 20;
    const before = beforeParam ? Number.parseInt(beforeParam, 10) : undefined;

    return c.json({
      ...(await listMessages(
        c.req.param("accountId"),
        c.req.param("conversationId"),
        limit,
        Number.isFinite(before) ? before : undefined
      )),
    });
  });
}
