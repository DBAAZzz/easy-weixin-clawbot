import type { Hono } from "hono";
import { generateTapeGraph } from "@clawbot/agent/tape";

export function registerTapeRoutes(app: Hono) {
  app.get("/api/tape/graph", async (c) => {
    const accountId = c.req.query("accountId");
    if (!accountId) {
      return c.json({ error: "accountId is required" }, 400);
    }

    const branch = c.req.query("branch") ?? "__global__";
    return c.json({ data: await generateTapeGraph(accountId, branch) });
  });
}
