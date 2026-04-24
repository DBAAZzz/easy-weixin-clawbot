import { getBuiltinToolCatalogItem, listBuiltinToolCatalog } from "@clawbot/agent/tools/builtins";
import type { Hono } from "hono";

export function registerToolRoutes(app: Hono) {
  app.get("/api/tools", (c) => {
    return c.json({ data: listBuiltinToolCatalog() });
  });

  app.get("/api/tools/:name", (c) => {
    const tool = getBuiltinToolCatalogItem(c.req.param("name"));
    if (!tool) {
      return c.json({ error: "tool not found" }, 404);
    }
    return c.json({ data: tool });
  });
}
