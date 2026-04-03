import type { Hono } from "hono";
import type { ObservabilityWindow } from "@clawbot/shared";
import type { ObservabilityRouteService } from "../../observability/service.js";

function parseWindow(value: string | undefined): ObservabilityWindow {
  if (value === "7d" || value === "30d") return value;
  return "24h";
}

export function registerObservabilityRoutes(app: Hono, observability: ObservabilityRouteService) {
  app.get("/api/observability/overview", async (c) => {
    const window = parseWindow(c.req.query("window"));
    return c.json({ data: await observability.getOverview(window) });
  });

  app.get("/api/observability/traces", async (c) => {
    const limitParam = Number.parseInt(c.req.query("limit") ?? "20", 10);
    const cursorParam = c.req.query("cursor");
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 100) : 20;
    const cursor = cursorParam ? Number.parseInt(cursorParam, 10) : undefined;
    const statusParam = c.req.query("status");
    const status =
      statusParam === "ok" || statusParam === "error" ? statusParam : undefined;

    return c.json(
      await observability.listTraces({
        window: parseWindow(c.req.query("window")),
        limit,
        cursor: Number.isFinite(cursor) ? cursor : undefined,
        accountId: c.req.query("accountId") ?? undefined,
        conversationId: c.req.query("conversationId") ?? undefined,
        flag: c.req.query("flag") ?? undefined,
        status,
        query: c.req.query("query") ?? undefined,
      }),
    );
  });

  app.get("/api/observability/traces/:traceId", async (c) => {
    const trace = await observability.getTrace(c.req.param("traceId"));
    if (!trace) {
      return c.json({ error: "Trace not found" }, 404);
    }
    return c.json({ data: trace });
  });

  app.get("/api/metrics", (c) => {
    return c.body(observability.getMetricsText(), 200, {
      "Content-Type": "text/plain; charset=UTF-8",
    });
  });
}
