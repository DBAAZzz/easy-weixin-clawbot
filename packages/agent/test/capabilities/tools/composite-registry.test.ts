/**
 * Composite tool registry — merge order, name-conflict resolution, and the
 * invariant that binds them: what `current()` advertises to the model and what
 * `execute()` actually runs must come from the same registry. If those two ever
 * disagree the model sees one tool's schema while a different implementation
 * runs, which no error surfaces.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { createCompositeToolRegistry } from "../../../src/capabilities/tools/composite-registry.js";
import type {
  ToolContent,
  ToolContext,
  ToolRegistry,
  ToolSnapshot,
} from "../../../src/capabilities/tools/types.js";

/** A registry whose tools all report which registry executed them. */
function createFakeRegistry(label: string, toolNames: string[]): ToolRegistry {
  let snapshot: ToolSnapshot = {
    tools: toolNames.map((name) => ({
      name,
      description: `${name} from ${label}`,
      parameters: z.object({}),
      async execute(): Promise<ToolContent[]> {
        return [{ type: "text", text: `${name}@${label}` }];
      },
    })),
  };

  return {
    swap(next) {
      snapshot = next;
    },
    current() {
      return snapshot;
    },
    async execute(name, _args, _ctx: ToolContext) {
      const tool = snapshot.tools.find((t) => t.name === name);
      if (!tool) throw new Error(`Unknown tool: ${name}`);
      return tool.execute({}, _ctx);
    },
  };
}

function ctx(): ToolContext {
  return { signal: new AbortController().signal };
}

function names(registry: ToolRegistry): string[] {
  return registry.current().tools.map((t) => t.name);
}

async function runTool(registry: ToolRegistry, name: string): Promise<string> {
  const [block] = await registry.execute(name, {}, ctx());
  assert.equal(block?.type, "text");
  return (block as { type: "text"; text: string }).text;
}

test("merged snapshot concatenates registries in registration order", async () => {
  const composite = createCompositeToolRegistry(
    createFakeRegistry("local", ["read_file", "write_file"]),
    createFakeRegistry("mcp", ["query_db"]),
  );

  assert.deepEqual(names(composite), ["read_file", "write_file", "query_db"]);
});

test("an MCP server cannot shadow a built-in tool by reusing its name", async () => {
  // docs/2026-07-23_18_10_mcp-runtime-walkthrough.md:159-165 — 「注册顺序即优先级
  // …同名工具只保留第一个，所以 MCP 工具无法覆盖内置工具——这是有意的防护」.
  // A user-configured MCP server is a lower-trust source than the built-ins, so
  // this is a security property, not a merge detail: without it, connecting a
  // server that exports `web_fetch` would silently redirect every built-in call.
  const composite = createCompositeToolRegistry(
    createFakeRegistry("local", ["web_fetch"]),
    createFakeRegistry("mcp", ["web_fetch", "query_db"]),
  );

  assert.deepEqual(names(composite), ["web_fetch", "query_db"]);
  assert.equal(composite.current().tools.length, 2);
  assert.equal(await runTool(composite, "web_fetch"), "web_fetch@local");
});

test("execute routes a conflicted name to the same registry the snapshot advertised", async () => {
  const composite = createCompositeToolRegistry(
    createFakeRegistry("local", ["web_fetch"]),
    createFakeRegistry("mcp", ["web_fetch"]),
  );

  const advertised = composite.current().tools.find((t) => t.name === "web_fetch");
  assert.equal(advertised?.description, "web_fetch from local");
  // Same owner on the execute path — this is the invariant, not a coincidence of
  // both happening to scan front-to-back.
  assert.equal(await runTool(composite, "web_fetch"), "web_fetch@local");
});

test("execute re-resolves the owner after a sub-registry swaps its snapshot", async () => {
  const local = createFakeRegistry("local", ["shared_tool"]);
  const mcp = createFakeRegistry("mcp", ["shared_tool"]);
  const composite = createCompositeToolRegistry(local, mcp);

  assert.equal(await runTool(composite, "shared_tool"), "shared_tool@local");

  // The first registry drops the tool (e.g. a markdown tool file was deleted and
  // the local registry reloaded). Ownership must fall through to the next
  // registry rather than sticking to a cached owner.
  local.swap({ tools: [] });

  assert.deepEqual(names(composite), ["shared_tool"]);
  assert.equal(await runTool(composite, "shared_tool"), "shared_tool@mcp");
});

test("an unknown tool name fails loudly instead of silently no-op'ing", async () => {
  const composite = createCompositeToolRegistry(createFakeRegistry("local", ["read_file"]));

  await assert.rejects(() => composite.execute("no_such_tool", {}, ctx()), /Unknown tool: no_such_tool/);
});

test("a composite of empty registries reports no tools", async () => {
  const composite = createCompositeToolRegistry(
    createFakeRegistry("local", []),
    createFakeRegistry("mcp", []),
  );

  assert.deepEqual(names(composite), []);
});

test("the composite itself cannot be swapped — only its members can", async () => {
  const composite = createCompositeToolRegistry(createFakeRegistry("local", ["read_file"]));

  assert.throws(() => composite.swap({ tools: [] }), /cannot be swapped directly/);
  // The rejected swap left the merged view intact.
  assert.deepEqual(names(composite), ["read_file"]);
});
