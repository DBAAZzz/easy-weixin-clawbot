import type { ToolInstaller, SkillInstaller } from "@clawbot/agent";
import type { Hono } from "hono";

async function readMarkdownPayload(request: Request): Promise<string> {
  const body = (await request.json().catch(() => null)) as { markdown?: unknown } | null;
  if (!body || typeof body.markdown !== "string" || body.markdown.trim() === "") {
    throw new Error("markdown is required");
  }
  return body.markdown;
}

export function registerSkillRoutes(app: Hono, installer: SkillInstaller, toolInstaller: ToolInstaller) {
  app.get("/api/skills", (c) => {
    return c.json({ data: installer.list() });
  });

  app.get("/api/skills/:name", (c) => {
    const skill = installer.get(c.req.param("name"));
    if (!skill) {
      return c.json({ error: "skill not found" }, 404);
    }
    return c.json({ data: skill });
  });

  app.get("/api/skills/:name/source", async (c) => {
    const markdown = await installer.getSource(c.req.param("name"));
    if (!markdown) {
      return c.json({ error: "skill not found" }, 404);
    }
    return c.json({ data: { markdown } });
  });

  app.post("/api/skills/validate", async (c) => {
    try {
      const markdown = await readMarkdownPayload(c.req.raw);
      return c.json({ data: await installer.validate(markdown) });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "invalid request" }, 400);
    }
  });

  app.post("/api/skills", async (c) => {
    try {
      const markdown = await readMarkdownPayload(c.req.raw);
      return c.json({ data: await installer.install(markdown) }, 201);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "invalid request" }, 400);
    }
  });

  app.put("/api/skills/:name", async (c) => {
    try {
      const markdown = await readMarkdownPayload(c.req.raw);
      return c.json({ data: await installer.update(c.req.param("name"), markdown) });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "invalid request" }, 400);
    }
  });

  app.delete("/api/skills/:name", async (c) => {
    try {
      await installer.remove(c.req.param("name"));
      return c.json({ data: { name: c.req.param("name") } });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "invalid request" }, 400);
    }
  });

  app.post("/api/skills/:name/enable", async (c) => {
    try {
      return c.json({ data: await installer.enable(c.req.param("name")) });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "invalid request" }, 400);
    }
  });

  app.post("/api/skills/:name/disable", async (c) => {
    try {
      return c.json({ data: await installer.disable(c.req.param("name")) });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "invalid request" }, 400);
    }
  });

  app.get("/api/legacy/skills", (c) => {
    return c.json({
      data: toolInstaller.list().map((tool) => ({
        id: tool.name,
        summary: tool.summary,
        version: tool.version,
        author: tool.author,
        parameterNames: tool.parameterNames,
      })),
    });
  });

  app.get("/api/capabilities", (c) => {
    return c.json({
      data: {
        tools: toolInstaller.list(),
        skills: installer.list(),
      },
    });
  });
}
