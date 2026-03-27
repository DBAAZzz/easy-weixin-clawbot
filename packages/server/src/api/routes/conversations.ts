import type { Hono } from "hono";
import { listConversations } from "../../db/conversations.js";

export function registerConversationRoutes(app: Hono) {
  app.get("/api/accounts/:accountId/conversations", async (c) => {
    return c.json({ data: await listConversations(c.req.param("accountId")) });
  });
}
