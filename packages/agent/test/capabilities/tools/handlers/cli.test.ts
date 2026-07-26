/**
 * Security boundary of the CLI tool handler.
 *
 * The arguments here originate from an LLM driven by untrusted input (WeChat
 * messages, webhooks), so these two guards — the binary allowlist and the shell
 * metacharacter rejection — are what stands between a prompt injection and
 * arbitrary local command execution. Every case below asserts a *rejection*, and
 * rejection happens before `@clawbot/exec` is ever called, so no subprocess is
 * spawned while the guards hold.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { cliHandler } from "../../../../src/capabilities/tools/handlers/cli.js";

function ctx() {
  return { signal: new AbortController().signal };
}

function execute(config: Record<string, unknown>, command: unknown) {
  return cliHandler.execute({ command }, config, ctx());
}

// Binaries that were deliberately removed from the allowlist: `docker` is
// equivalent to local root (`-v /:/host`), and `curl` bypasses the private-IP /
// localhost / metadata-endpoint protections that WebToolService implements for
// web_fetch. Re-adding either must fail this test, not a review.
for (const binary of ["docker", "curl", "bash", "sh", "node", "python3", "gh"]) {
  test(`cli handler refuses the "${binary}" binary — allowlist is opencli only`, async () => {
    await assert.rejects(
      () => execute({ binary }, "--version"),
      new RegExp(`Binary is not allowed: ${binary}`),
    );
  });
}

test("cli handler refuses a missing or non-string binary rather than defaulting", async () => {
  await assert.rejects(() => execute({}, "--version"), /Binary is not allowed: \(missing\)/);
  await assert.rejects(() => execute({ binary: 42 }, "--version"), /Binary is not allowed/);
  await assert.rejects(() => execute({ binary: "" }, "--version"), /Binary is not allowed/);
});

// execFile does not go through a shell, so these characters cannot chain
// commands today. They are still rejected so that a future switch to a
// shell-backed exec path cannot silently turn old tool definitions into
// injection sinks.
const SHELL_METACHARACTERS: Array<[string, string]> = [
  ["pipe", "status | tee /tmp/out"],
  ["or-chain", "status || rm -rf /"],
  ["and-chain", "status && curl http://169.254.169.254/"],
  ["semicolon", "status; whoami"],
  ["backtick", "status `whoami`"],
  ["command-substitution", "status $(whoami)"],
  ["newline", "status\nwhoami"],
  ["carriage-return", "status\rwhoami"],
];

for (const [label, command] of SHELL_METACHARACTERS) {
  test(`cli handler rejects ${label} in the command string`, async () => {
    await assert.rejects(
      () => execute({ binary: "opencli" }, command),
      /forbidden shell metacharacters/,
    );
  });
}

test("cli handler requires a non-empty command", async () => {
  await assert.rejects(() => execute({ binary: "opencli" }, ""), /non-empty command/);
  await assert.rejects(() => execute({ binary: "opencli" }, "   "), /non-empty command/);
  await assert.rejects(() => execute({ binary: "opencli" }, undefined), /non-empty command/);
  await assert.rejects(() => execute({ binary: "opencli" }, { toString: () => "x" }), /non-empty command/);
});

test("the binary comes from the tool definition, never from model-supplied args", async () => {
  // A model that tries to smuggle `binary` through the tool arguments must not
  // be able to override handlerConfig — args are the untrusted side.
  await assert.rejects(
    () => cliHandler.execute({ command: "--version", binary: "opencli" }, { binary: "curl" }, ctx()),
    /Binary is not allowed: curl/,
  );
});
