#!/usr/bin/env node
/**
 * Enforces the @clawbot/agent module layering (docs/2026-04-01_17_39_agent-architecture.md).
 *
 * Layers, high to low (a file may only *value*-import from its own layer's
 * allowed siblings or a strictly lower layer — never a higher one):
 *
 *   L5 engine
 *   L4 capabilities/{skills,mcp,scheduler,heartbeat}
 *   L4 capabilities/tools        (base of capabilities — the other four may import it, not vice versa)
 *   L3 memory, context-compiler
 *   L2 llm                       (may import prompts)
 *   L2 prompts, commands         (independent of each other and of llm)
 *   L1 ports
 *   L0 shared
 *
 * Upward `import type` carries no runtime dependency, but it is still coupling
 * — and the reverse edge this refactor removed (prompts -> skills/types) was
 * type-only, so blanket-exempting types would leave the guardrail unable to
 * catch the very class of problem it exists for. Upward type imports are
 * therefore checked too, against the explicit TYPE_EXEMPT allowlist below:
 * adding one is a deliberate, reviewable act rather than an invisible drift.
 *
 * src/index.ts is the public barrel and may import anything. src/test/ is
 * test fixture code, not layered product code, and is excluded.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, normalize, relative } from "node:path";
import { fileURLToPath } from "node:url";

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

const RANK = {
  engine: 5,
  "capabilities/skills": 4,
  "capabilities/mcp": 4,
  "capabilities/scheduler": 4,
  "capabilities/heartbeat": 4,
  "capabilities/tools": 4,
  "capabilities/outbound-facts.ts": 4,
  memory: 3,
  "context-compiler": 3,
  llm: 2,
  prompts: 2,
  commands: 2,
  ports: 1,
  shared: 0,
};

/** Same-rank exceptions: `from` may value-import `to` despite equal rank. */
const SAME_RANK_ALLOWED = new Set([
  "capabilities/skills->capabilities/tools",
  "capabilities/mcp->capabilities/tools",
  "capabilities/scheduler->capabilities/tools",
  "capabilities/heartbeat->capabilities/tools",
  "llm->prompts",
]);

/**
 * Upward `import type` edges that are deliberate cross-cutting vocabulary.
 * Each entry is a port or shared helper naming a domain type it transports but
 * does not own. Anything not listed here is a violation — add with a reason.
 */
const TYPE_EXEMPT = new Set([
  // Ports describe IO over domain types owned by the layer above them.
  "ports->capabilities/tools", //     RunKind, on ChatExecutionRequest
  "ports->capabilities/heartbeat", // PendingGoalRow & co, on HeartbeatStore
  "ports->llm", //                    AgentMessage, on MessageStore
  // Message-shape helpers operate on the LLM vocabulary without depending on it.
  "shared->llm", //                   AgentMessage, in chat-utils
]);

function topDir(relPath) {
  const parts = relPath.split("/");
  if (parts[0] === "capabilities") return `capabilities/${parts[1]}`;
  return parts[0];
}

function listFiles(dir) {
  let out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out = out.concat(listFiles(full));
    } else if (name.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

// Matches both `import ... from "./x.js"` and `export ... from "./x.js"`,
// capturing whether the import is type-only.
const IMPORT_RE = /(import|export)(\s+type)?\s+(?:[^'"]*?\s+from\s+)?["'](\.[^"']+)["']/g;
// `await import("./x.js")` — a value dependency the static form above misses.
const DYNAMIC_IMPORT_RE = /\bimport\s*\(\s*["'](\.[^"']+)["']/g;

function checkFile(absPath) {
  const relPath = relative(SRC_DIR, absPath).split("\\").join("/");
  if (relPath === "index.ts" || relPath.startsWith("test/")) return [];

  const fromDir = topDir(relPath);
  const fromRank = RANK[fromDir];
  if (fromRank === undefined) {
    throw new Error(
      `check-layers: unranked directory "${fromDir}" (file: ${relPath}). Add it to RANK.`,
    );
  }

  const content = readFileSync(absPath, "utf8");
  const violations = [];

  const check = (specifier, isTypeOnly) => {
    const resolved = normalize(join(dirname(relPath), specifier))
      .split("\\")
      .join("/");
    const toDir = topDir(resolved);
    if (toDir === fromDir) return;

    const toRank = RANK[toDir];
    if (toRank === undefined) return; // e.g. relative import that escapes src/ (shouldn't happen)

    if (fromDir === "context-compiler" && toDir !== "ports" && toDir !== "shared") {
      violations.push(
        `${relPath}: imports "${specifier}" from ${toDir} — context-compiler may only import its own layer, ports, and shared`,
      );
      return;
    }

    const edge = `${fromDir}->${toDir}`;
    if (toRank < fromRank) return; // strictly downward, fine
    if (toRank === fromRank && SAME_RANK_ALLOWED.has(edge)) return;

    if (isTypeOnly) {
      if (TYPE_EXEMPT.has(edge)) return;
      violations.push(
        `${relPath}: type-imports "${specifier}" (${fromDir} [L${fromRank}] -> ${toDir} [L${toRank}]) ` +
          `— upward type edge not in TYPE_EXEMPT`,
      );
      return;
    }

    violations.push(
      `${relPath}: value-imports "${specifier}" (${fromDir} [L${fromRank}] -> ${toDir} [L${toRank}]) — not allowed by layering rules`,
    );
  };

  let match;
  IMPORT_RE.lastIndex = 0;
  while ((match = IMPORT_RE.exec(content))) {
    check(match[3], Boolean(match[2]));
  }

  DYNAMIC_IMPORT_RE.lastIndex = 0;
  while ((match = DYNAMIC_IMPORT_RE.exec(content))) {
    check(match[1], false);
  }

  if (fromDir === "context-compiler") {
    for (const forbidden of ["@clawbot/server", "@clawbot/weixin-agent-sdk"]) {
      if (content.includes(`"${forbidden}`) || content.includes(`'${forbidden}`)) {
        violations.push(`${relPath}: context-compiler must not import ${forbidden}`);
      }
    }
  }

  return violations;
}

const files = listFiles(SRC_DIR);
const violations = files.flatMap(checkFile);

if (violations.length > 0) {
  console.error(`check-layers: ${violations.length} layering violation(s):\n`);
  for (const v of violations) console.error(`  ${v}`);
  console.error("\nSee docs/2026-04-01_17_39_agent-architecture.md for the layering rules.");
  process.exit(1);
}

console.log(`check-layers: ${files.length} files checked, no violations.`);
