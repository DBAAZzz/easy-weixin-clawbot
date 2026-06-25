import type { Hono } from "hono";
import type { ObservabilityWindow } from "@clawbot/shared";
import type { ObservabilityRouteService } from "../../observability/service.js";
import { parseLimitParam, parsePositiveIntParam } from "../params.js";

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
    const cursorParam = c.req.query("cursor");
    const cursor = cursorParam ? parsePositiveIntParam(cursorParam) : undefined;
    const statusParam = c.req.query("status");
    const status =
      statusParam === "ok" || statusParam === "error" ? statusParam : undefined;

    if (cursorParam && cursor === null) {
      return c.json({ error: "cursor must be a positive integer" }, 400);
    }

    const cursorId = cursor ?? undefined;

    return c.json(
      await observability.listTraces({
        window: parseWindow(c.req.query("window")),
        limit: parseLimitParam(c.req.query("limit")),
        cursor: cursorId,
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
