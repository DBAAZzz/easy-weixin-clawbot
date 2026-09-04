import type { Hono } from "hono";
import type { HealthStatus } from "@clawbot/shared";
import { isDemoMode } from "../../config/demo-mode.js";
import { getPendingMessageWriteCount } from "../../db/messages.js";
import { getPendingUsageWriteCount } from "../../db/usage.js";
import { observabilityService } from "../../observability/service.js";
import type { ApiDependencies } from "../index.js";

export function registerHealthRoutes(app: Hono, dependencies: ApiDependencies) {
  app.get("/api/health", (c) => {
    const payload: HealthStatus = {
      status: "ok",
      uptime_ms: dependencies.runtime.getUptimeMs(),
      started_at: dependencies.startedAt.toISOString(),
      running_account_count: dependencies.runtime.getRunningAccountIds().length,
      pending_message_writes: getPendingMessageWriteCount(),
      pending_trace_writes: observabilityService.getPendingWriteCount(),
      pending_usage_writes: getPendingUsageWriteCount(),
      demo_mode: isDemoMode(),
    };

    return c.json({ data: payload });
  });
}
