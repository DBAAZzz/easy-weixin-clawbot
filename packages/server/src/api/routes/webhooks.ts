import type { Hono } from "hono";
import { webhookRoutes } from "../../webhooks/routes.js";

export function registerWebhookRoutes(app: Hono) {
  app.route("/api/webhooks", webhookRoutes);
}
