import type { ToolInstaller, SkillInstaller, RuntimeProvisioner } from "@clawbot/agent";
import { execFile } from "node:child_process";
import { access, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import type { Hono } from "hono";
import { streamSSE } from "hono/streaming";

const execFileAsync = promisify(execFile);

async function readMarkdownPayload(request: Request): Promise<string> {
  const body = (await request.json().catch(() => null)) as { markdown?: unknown } | null;
  if (!body || typeof body.markdown !== "string" || body.markdown.trim() === "") {
    throw new Error("markdown is required");
  }
  return body.markdown;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function buildLocalRunCheck(
  installed: NonNullable<ReturnType<SkillInstaller["getInstalled"]>>,
  provisioner?: RuntimeProvisioner,
): Promise<{ canRunNow: boolean; checks: Array<{ status: "ok" | "fail" | "info"; message: string }> }> {
  const checks: Array<{ status: "ok" | "fail" | "info"; message: string }> = [];
  const detected = installed.skill.detectedRuntime;
  const skillDir = dirname(installed.skill.source.filePath);

  if (!detected || detected.kind === "knowledge-only") {
    checks.push({ status: "info", message: "This is a knowledge-only skill package." });
    return { canRunNow: true, checks };
  }

  checks.push({ status: "info", message: `Detected runtime kind: ${detected.kind}` });

  if (detected.kind === "manual-needed") {
    for (const issue of detected.issues) {
      checks.push({ status: "fail", message: issue });
    }
    return { canRunNow: false, checks };
  }

  const entrypoint = detected.entrypoint?.path;
  if (!entrypoint) {
    checks.push({ status: "fail", message: `Detected ${detected.kind} skill is missing an entrypoint.` });
  } else if (await fileExists(join(skillDir, entrypoint))) {
    checks.push({ status: "ok", message: `Entrypoint exists: ${entrypoint}` });
  } else {
    checks.push({ status: "fail", message: `Entrypoint not found: ${entrypoint}` });
  }

  try {
    if (detected.kind === "python-script") {
      await execFileAsync("python3", ["--version"]);
      checks.push({ status: "ok", message: "python3 is available on host." });
    } else if (detected.kind === "node-script") {
      await execFileAsync("node", ["--version"]);
      checks.push({ status: "ok", message: "node is available on host." });
    }
  } catch {
    checks.push({
      status: "fail",
      message: detected.kind === "python-script" ? "python3 is not available on host." : "node is not available on host.",
    });
  }

  if (installed.provisionStatus !== "ready") {
    checks.push({
      status: "fail",
      message: `Runtime is not ready (status=${installed.provisionStatus ?? "pending"}), run /provision first.`,
    });
  } else if (provisioner) {
    const healthy = await provisioner.healthCheck(installed);
    checks.push({
      status: healthy ? "ok" : "fail",
      message: healthy
        ? "Runtime health check passed."
        : "Runtime health check failed (interpreter or entrypoint not healthy).",
    });
  }

  const canRunNow = !checks.some((check) => check.status === "fail");
  return { canRunNow, checks };
}

function isAutoProvisionableSkill(
  installed: NonNullable<ReturnType<SkillInstaller["getInstalled"]>>,
): boolean {
  const kind = installed.skill.detectedRuntime?.kind;
  return kind === "python-script" || kind === "node-script";
}

/**
 * Extract a ZIP file to a temp directory and locate SKILL.md.
 * Returns the directory path containing SKILL.md (caller must clean up parent).
 */
async function extractZipToTemp(zipBuffer: ArrayBuffer): Promise<{ extractDir: string; tempRoot: string }> {
  const tempRoot = await mkdtemp(join(tmpdir(), "skill-upload-"));
  const zipPath = join(tempRoot, "upload.zip");
  await writeFile(zipPath, Buffer.from(zipBuffer));

  const extractDir = join(tempRoot, "extracted");
  await execFileAsync("unzip", ["-o", "-q", zipPath, "-d", extractDir]);

  // Locate SKILL.md — either at root or inside a single top-level directory
  const entries = await readdir(extractDir, { withFileTypes: true });
  const hasSkillMd = entries.some((e) => e.isFile() && e.name === "SKILL.md");
  if (hasSkillMd) {
    return { extractDir, tempRoot };
  }

  // Check if there's a single top-level directory containing SKILL.md
  const dirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith("__"));
  if (dirs.length === 1) {
    const nested = join(extractDir, dirs[0].name);
    return { extractDir: nested, tempRoot };
  }

  // Clean up on failure
  await rm(tempRoot, { recursive: true }).catch(() => {});
  throw new Error("SKILL.md not found in ZIP archive — expected at root or inside a single directory");
}

export function registerSkillRoutes(
  app: Hono,
  installer: SkillInstaller,
  toolInstaller: ToolInstaller,
  provisioner?: RuntimeProvisioner,
) {
  // ── ZIP / Markdown file upload ──
  app.post("/api/skills/upload", async (c) => {
    let tempRoot: string | undefined;
    try {
      const formData = await c.req.formData();
      const file = formData.get("file");
      if (!file || !(file instanceof File)) {
        return c.json({ error: "file is required (multipart form field 'file')" }, 400);
      }

      const name = file.name.toLowerCase();
      if (name.endsWith(".md")) {
        // Single markdown file — use existing install path
        const markdown = await file.text();
        const result = await installer.install(markdown);
        const installed = installer.getInstalled(result.name);
        const localRunCheck = installed
          ? await buildLocalRunCheck(installed, provisioner)
          : { canRunNow: false, checks: [{ status: "fail" as const, message: "skill install state missing" }] };
        return c.json({ data: { ...result, localRunCheck } }, 201);
      }

      if (name.endsWith(".zip")) {
        const buffer = await file.arrayBuffer();
        const { extractDir, tempRoot: root } = await extractZipToTemp(buffer);
        tempRoot = root;
        const result = await installer.installDirectory(extractDir);
        const installed = installer.getInstalled(result.name);
        const localRunCheck = installed
          ? await buildLocalRunCheck(installed, provisioner)
          : { canRunNow: false, checks: [{ status: "fail" as const, message: "skill install state missing" }] };
        return c.json({ data: { ...result, localRunCheck } }, 201);
      }

      return c.json({ error: "Unsupported file type. Please upload a .zip or .md file." }, 400);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "upload failed" }, 400);
    } finally {
      if (tempRoot) {
        void rm(tempRoot, { recursive: true }).catch(() => {});
      }
    }
  });

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
      const dryRun = c.req.query("dryRun") === "true";
      const markdown = await readMarkdownPayload(c.req.raw);
      if (dryRun) {
        return c.json({ data: await installer.validate(markdown) });
      }
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

  // ── Runtime provisioning endpoints ──

  app.post("/api/skills/:name/provision", async (c) => {
    if (!provisioner) {
      return c.json({ error: "Runtime provisioner is not available" }, 501);
    }
    const name = c.req.param("name");
    const installed = installer.getInstalled(name);
    if (!installed) {
      return c.json({ error: "skill not found" }, 404);
    }
    if (!isAutoProvisionableSkill(installed)) {
      return c.json({ error: `skill is not an auto-provisionable script skill (kind=${installed.skill.detectedRuntime?.kind ?? "knowledge-only"})` }, 400);
    }

    try {
      await installer.setProvisionStatus(name, "provisioning");
      const logs = await provisioner.provision(installed);
      await installer.setProvisionStatus(name, "ready");
      return c.json({ data: { status: "ready", logs } });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      await installer.setProvisionStatus(name, "failed", msg);
      return c.json({ error: msg }, 500);
    }
  });

  app.post("/api/skills/:name/reprovision", async (c) => {
    if (!provisioner) {
      return c.json({ error: "Runtime provisioner is not available" }, 501);
    }
    const name = c.req.param("name");
    const installed = installer.getInstalled(name);
    if (!installed) {
      return c.json({ error: "skill not found" }, 404);
    }
    if (!isAutoProvisionableSkill(installed)) {
      return c.json({ error: `skill is not an auto-provisionable script skill (kind=${installed.skill.detectedRuntime?.kind ?? "knowledge-only"})` }, 400);
    }

    try {
      await installer.setProvisionStatus(name, "provisioning");
      const logs = await provisioner.reprovision(installed);
      await installer.setProvisionStatus(name, "ready");
      return c.json({ data: { status: "ready", logs } });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      await installer.setProvisionStatus(name, "failed", msg);
      return c.json({ error: msg }, 500);
    }
  });

  app.get("/api/skills/:name/provision/logs", async (c) => {
    if (!provisioner) {
      return c.json({ error: "Runtime provisioner is not available" }, 501);
    }
    const name = c.req.param("name");
    const installed = installer.getInstalled(name);
    if (!installed) {
      return c.json({ error: "skill not found" }, 404);
    }
    if (!isAutoProvisionableSkill(installed)) {
      return c.json({ error: `skill is not an auto-provisionable script skill (kind=${installed.skill.detectedRuntime?.kind ?? "knowledge-only"})` }, 400);
    }

    // SSE-based streaming provision
    return streamSSE(c, async (stream) => {
      try {
        await installer.setProvisionStatus(name, "provisioning");
        for await (const log of provisioner.provisionStream(installed)) {
          await stream.writeSSE({
            event: "log",
            data: JSON.stringify(log),
          });
        }
        await installer.setProvisionStatus(name, "ready");
        await stream.writeSSE({ event: "done", data: JSON.stringify({ status: "ready" }) });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        await installer.setProvisionStatus(name, "failed", msg);
        await stream.writeSSE({ event: "error", data: JSON.stringify({ error: msg }) });
      }
    });
  });

  app.get("/api/skills/:name/preflight", async (c) => {
    if (!provisioner) {
      return c.json({ error: "Runtime provisioner is not available" }, 501);
    }
    const name = c.req.param("name");
    const installed = installer.getInstalled(name);
    if (!installed) {
      return c.json({ error: "skill not found" }, 404);
    }
    if (!isAutoProvisionableSkill(installed)) {
      return c.json({ error: `skill is not an auto-provisionable script skill (kind=${installed.skill.detectedRuntime?.kind ?? "knowledge-only"})` }, 400);
    }

    try {
      const plan = await provisioner.preflight(installed);
      return c.json({ data: plan });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "preflight failed" }, 500);
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
