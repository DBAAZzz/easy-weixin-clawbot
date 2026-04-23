import type { Hono } from "hono";
import { executeTask, getSchedulerStore, schedulerManager } from "@clawbot/agent";
import {
  RssNotFoundError,
  RssValidationError,
  createRssScheduledTaskHandler,
  rssService,
} from "../../rss/service.js";

function toErrorResponse(error: unknown) {
  if (error instanceof RssValidationError) {
    return { status: 400 as const, message: error.message };
  }

  if (error instanceof RssNotFoundError) {
    return { status: 404 as const, message: error.message };
  }

  throw error;
}

export function registerRssRoutes(app: Hono) {
  app.get("/api/rss/sources", async (c) => {
    return c.json({ data: await rssService.listSources() });
  });

  app.post("/api/rss/sources", async (c) => {
    try {
      const body = await c.req.json().catch(() => null);
      return c.json({ data: await rssService.createSource(body) });
    } catch (error) {
      const response = toErrorResponse(error);
      return c.json({ error: response.message }, response.status);
    }
  });

  app.patch("/api/rss/sources/:id", async (c) => {
    try {
      const body = await c.req.json().catch(() => null);
      return c.json({ data: await rssService.updateSource(c.req.param("id"), body) });
    } catch (error) {
      const response = toErrorResponse(error);
      return c.json({ error: response.message }, response.status);
    }
  });

  app.delete("/api/rss/sources/:id", async (c) => {
    try {
      await rssService.deleteSource(c.req.param("id"));
      return c.json({ data: { success: true } });
    } catch (error) {
      const response = toErrorResponse(error);
      return c.json({ error: response.message }, response.status);
    }
  });

  app.get("/api/rss/sources/:id/preview", async (c) => {
    try {
      return c.json({ data: await rssService.previewSource(c.req.param("id")) });
    } catch (error) {
      const response = toErrorResponse(error);
      return c.json({ error: response.message }, response.status);
    }
  });

  app.post("/api/rss/sources/:id/test", async (c) => {
    try {
      return c.json({ data: await rssService.testSource(c.req.param("id")) });
    } catch (error) {
      const response = toErrorResponse(error);
      return c.json({ error: response.message }, response.status);
    }
  });

  app.post("/api/rss/settings/test", async (c) => {
    return c.json({ data: await rssService.testSettingsConnection() });
  });

  app.get("/api/rss/tasks", async (c) => {
    return c.json({ data: await rssService.listTasks(c.req.query("accountId") ?? undefined) });
  });

  app.post("/api/rss/tasks", async (c) => {
    try {
      const body = await c.req.json().catch(() => null);
      const task = await rssService.createTask(body);
      const runtimeTask = await getSchedulerStore().getTaskBySeq(task.account_id, task.seq);
      if (runtimeTask?.enabled) {
        schedulerManager.activate(runtimeTask);
      }
      return c.json({ data: task });
    } catch (error) {
      const response = toErrorResponse(error);
      return c.json({ error: response.message }, response.status);
    }
  });

  app.patch("/api/rss/tasks/:accountId/:seq", async (c) => {
    const accountId = c.req.param("accountId");
    const seq = Number.parseInt(c.req.param("seq"), 10);
    if (Number.isNaN(seq)) {
      return c.json({ error: "Invalid seq parameter" }, 400);
    }

    try {
      const before = await rssService.getTaskRuntime(accountId, seq);
      const body = await c.req.json().catch(() => null);
      const task = await rssService.updateTask(accountId, seq, body);
      const runtimeTask = await getSchedulerStore().getTaskBySeq(task.account_id, task.seq);
      if (runtimeTask?.enabled) {
        schedulerManager.activate(runtimeTask);
      } else {
        schedulerManager.deactivate(before.id);
      }
      return c.json({ data: task });
    } catch (error) {
      const response = toErrorResponse(error);
      return c.json({ error: response.message }, response.status);
    }
  });

  app.delete("/api/rss/tasks/:accountId/:seq", async (c) => {
    const accountId = c.req.param("accountId");
    const seq = Number.parseInt(c.req.param("seq"), 10);
    if (Number.isNaN(seq)) {
      return c.json({ error: "Invalid seq parameter" }, 400);
    }

    try {
      const task = await rssService.getTaskRuntime(accountId, seq);
      await rssService.deleteTask(accountId, seq);
      schedulerManager.deactivate(task.id);
      return c.json({ data: { success: true } });
    } catch (error) {
      const response = toErrorResponse(error);
      return c.json({ error: response.message }, response.status);
    }
  });

  app.get("/api/rss/tasks/:accountId/:seq/preview", async (c) => {
    const seq = Number.parseInt(c.req.param("seq"), 10);
    if (Number.isNaN(seq)) {
      return c.json({ error: "Invalid seq parameter" }, 400);
    }

    try {
      return c.json({ data: await rssService.previewTask(c.req.param("accountId"), seq) });
    } catch (error) {
      const response = toErrorResponse(error);
      return c.json({ error: response.message }, response.status);
    }
  });

  app.post("/api/rss/tasks/:accountId/:seq/run", async (c) => {
    const accountId = c.req.param("accountId");
    const seq = Number.parseInt(c.req.param("seq"), 10);
    if (Number.isNaN(seq)) {
      return c.json({ error: "Invalid seq parameter" }, 400);
    }

    try {
      const task = await rssService.getTaskRuntime(accountId, seq);
      await executeTask(task);
      const [run] = await getSchedulerStore().listRuns(task.id, 1);
      return c.json({
        data: {
          success: true,
          run: run
            ? {
                id: run.id.toString(),
                status: run.status,
                prompt: run.prompt,
                result: run.result,
                duration_ms: run.durationMs,
                error: run.error,
                pushed: run.pushed,
                created_at: run.createdAt.toISOString(),
              }
            : null,
        },
      });
    } catch (error) {
      const response = toErrorResponse(error);
      return c.json({ error: response.message }, response.status);
    }
  });
}

export const rssTaskHandler = createRssScheduledTaskHandler();