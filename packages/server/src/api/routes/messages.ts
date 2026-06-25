import type { Hono } from "hono";
import { listMessages } from "../../db/messages.js";
import { parseLimitParam, parsePositiveIntParam } from "../params.js";

export function registerMessageRoutes(app: Hono) {
  app.get("/api/accounts/:accountId/conversations/:conversationId/messages", async (c) => {
    const beforeParam = c.req.query("before");
    const before = beforeParam ? parsePositiveIntParam(beforeParam) : undefined;

    if (beforeParam && before === null) {
      return c.json({ error: "before must be a positive integer" }, 400);
    }

    const beforeCursor = before ?? undefined;

    return c.json({
      ...(await listMessages(
        c.req.param("accountId"),
        c.req.param("conversationId"),
        parseLimitParam(c.req.query("limit")),
        beforeCursor,
      )),
    });
  });
}
