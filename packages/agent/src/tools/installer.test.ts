import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createToolInstaller } from "./installer.js";
import { createToolRegistry } from "./registry.js";

function createToolMarkdown(input: {
  name: string;
  summary: string;
  handler: "web-search" | "web-fetch" | "cli";
  parameterName?: string;
}): string {
  const parameterName = input.parameterName ?? "query";

  return `---
name: ${input.name}
version: 1.0.0
type: tool
author: clawbot
summary: ${input.summary}
handler: ${input.handler}
inputSchema:
  ${parameterName}:
    type: string
    description: test parameter
---
# ${input.name}

${input.summary}
`;
}

async function createFixture() {
  const rootDir = await mkdtemp(join(tmpdir(), "tool-installer-"));
  const builtinDir = join(rootDir, "tools", "builtin");
  const userDir = join(rootDir, "tools", "user");
  const statePath = join(rootDir, "tools", "state.json");

  await mkdir(builtinDir, { recursive: true });
  await mkdir(userDir, { recursive: true });

  return {
    rootDir,
    builtinDir,
    userDir,
    statePath,
    async cleanup() {
      await rm(rootDir, { recursive: true, force: true });
    },
  };
}

test("system tools stay enabled even when state.json disables them", async () => {
  const fixture = await createFixture();

  try {
    await writeFile(
      join(fixture.builtinDir, "web-search.md"),
      createToolMarkdown({
        name: "web_search",
        summary: "builtin web search",
        handler: "web-search",
      }),
      "utf8",
    );
    await writeFile(
      join(fixture.builtinDir, "opencli.md"),
      createToolMarkdown({
        name: "opencli",
        summary: "builtin cli bridge",
        handler: "cli",
        parameterName: "command",
      }),
      "utf8",
    );
    await writeFile(
      fixture.statePath,
      `${JSON.stringify(
        {
          items: {
            web_search: { enabled: false, installedAt: "2026-04-21T00:00:00.000Z" },
            opencli: { enabled: false, installedAt: "2026-04-21T00:00:00.000Z" },
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const registry = createToolRegistry();
    const installer = createToolInstaller(registry);

    await installer.initialize(fixture.builtinDir, fixture.userDir);

    const webSearch = installer.get("web_search");
    const opencli = installer.get("opencli");

    assert.ok(webSearch);
    assert.equal(webSearch.enabled, true);
    assert.equal(webSearch.managedBySystem, true);

    assert.ok(opencli);
    assert.equal(opencli.enabled, false);
    assert.equal(opencli.managedBySystem, false);

    assert.deepEqual(
      registry.current().tools.map((tool) => tool.name),
      ["web_search"],
    );

    const writtenState = JSON.parse(await readFile(fixture.statePath, "utf8")) as {
      items: Record<string, { enabled: boolean }>;
    };

    assert.equal(writtenState.items.web_search.enabled, true);
    assert.equal(writtenState.items.opencli.enabled, false);
  } finally {
    await fixture.cleanup();
  }
});

test("system tools cannot be overridden or disabled", async () => {
  const fixture = await createFixture();

  try {
    await writeFile(
      join(fixture.builtinDir, "web-search.md"),
      createToolMarkdown({
        name: "web_search",
        summary: "builtin web search",
        handler: "web-search",
      }),
      "utf8",
    );
    await writeFile(
      join(fixture.userDir, "web-search.md"),
      createToolMarkdown({
        name: "web_search",
        summary: "user override should be ignored",
        handler: "web-search",
      }),
      "utf8",
    );

    const registry = createToolRegistry();
    const installer = createToolInstaller(registry);
    const result = await installer.initialize(fixture.builtinDir, fixture.userDir);
    const webSearch = installer.get("web_search");

    assert.ok(webSearch);
    assert.equal(webSearch.summary, "builtin web search");
    assert.equal(result.failed.length, 1);
    assert.match(result.failed[0]!.error, /cannot override system builtin/i);

    await assert.rejects(
      installer.disable("web_search"),
      /System tool cannot be disabled: web_search/,
    );
    await assert.rejects(
      installer.validate(
        createToolMarkdown({
          name: "web_search",
          summary: "reserved tool name",
          handler: "web-search",
        }),
      ),
      /reserved for system builtin/i,
    );
  } finally {
    await fixture.cleanup();
  }
});
