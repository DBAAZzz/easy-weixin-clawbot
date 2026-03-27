import type { Hono } from "hono";
import type { HealthStatus } from "@clawbot/shared";
import { isLoggedIn } from "weixin-agent-sdk";
import { getPendingMessageWriteCount } from "../../db/messages.js";
import type { ApiDependencies } from "../index.js";

export function registerHealthRoutes(app: Hono, dependencies: ApiDependencies) {
  app.get("/api/health", (c) => {
    const payload: HealthStatus = {
      status: "ok",
      uptime_ms: dependencies.runtime.getUptimeMs(),
      started_at: dependencies.startedAt.toISOString(),
      logged_in: isLoggedIn(),
      running_accounts: dependencies.runtime.getRunningAccountIds(),
      pending_message_writes: getPendingMessageWriteCount(),
    };

    return c.json({ data: payload });
  });
}
