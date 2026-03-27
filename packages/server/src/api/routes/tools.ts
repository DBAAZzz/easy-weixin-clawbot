import type { ToolInstaller } from "@clawbot/agent";
import type { Hono } from "hono";

async function readMarkdownPayload(request: Request): Promise<string> {
  const body = (await request.json().catch(() => null)) as { markdown?: unknown } | null;
  if (!body || typeof body.markdown !== "string" || body.markdown.trim() === "") {
    throw new Error("markdown is required");
  }
  return body.markdown;
}

export function registerToolRoutes(app: Hono, installer: ToolInstaller) {
  app.get("/api/tools", (c) => {
    return c.json({ data: installer.list() });
  });

  app.get("/api/tools/:name", (c) => {
    const tool = installer.get(c.req.param("name"));
    if (!tool) {
      return c.json({ error: "tool not found" }, 404);
    }
    return c.json({ data: tool });
  });

  app.get("/api/tools/:name/source", async (c) => {
    const markdown = await installer.getSource(c.req.param("name"));
    if (!markdown) {
      return c.json({ error: "tool not found" }, 404);
    }
    return c.json({ data: { markdown } });
  });

  app.post("/api/tools/validate", async (c) => {
    try {
      const markdown = await readMarkdownPayload(c.req.raw);
      return c.json({ data: await installer.validate(markdown) });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "invalid request" }, 400);
    }
  });

  app.post("/api/tools", async (c) => {
    try {
      const markdown = await readMarkdownPayload(c.req.raw);
      return c.json({ data: await installer.install(markdown) }, 201);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "invalid request" }, 400);
    }
  });

  app.put("/api/tools/:name", async (c) => {
    try {
      const markdown = await readMarkdownPayload(c.req.raw);
      return c.json({ data: await installer.update(c.req.param("name"), markdown) });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "invalid request" }, 400);
    }
  });

  app.delete("/api/tools/:name", async (c) => {
    try {
      await installer.remove(c.req.param("name"));
      return c.json({ data: { name: c.req.param("name") } });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "invalid request" }, 400);
    }
  });

  app.post("/api/tools/:name/enable", async (c) => {
    try {
      return c.json({ data: await installer.enable(c.req.param("name")) });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "invalid request" }, 400);
    }
  });

  app.post("/api/tools/:name/disable", async (c) => {
    try {
      return c.json({ data: await installer.disable(c.req.param("name")) });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "invalid request" }, 400);
    }
  });
}
