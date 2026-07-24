import assert from "node:assert/strict";
import { test } from "node:test";
import { buildChildEnv } from "../src/env-policy.js";

function hostEnvFixture(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    PATH: "/usr/bin:/bin",
    HOME: "/home/test",
    TMPDIR: "/tmp",
    LANG: "en_US.UTF-8",
    HTTPS_PROXY: "http://proxy.local:8080",
    NODE_EXTRA_CA_CERTS: "/etc/ssl/custom.pem",
    LC_ALL: "en_US.UTF-8",
    LC_CTYPE: "en_US.UTF-8",
    CLAWBOT_CREDENTIAL_KEY: "super-secret",
    DATABASE_URL: "postgres://user:pass@host/db",
    AUTH_JWT_SECRET: "jwt-secret",
    NODE_OPTIONS: "--require=evil.js",
    ...overrides,
  };
}

test("default safe base excludes credentials", () => {
  const result = buildChildEnv({}, hostEnvFixture());
  assert.equal(result.CLAWBOT_CREDENTIAL_KEY, undefined);
  assert.equal(result.DATABASE_URL, undefined);
  assert.equal(result.AUTH_JWT_SECRET, undefined);
  assert.equal(result.NODE_OPTIONS, undefined);
});

test("safe base retains allowlisted keys", () => {
  const result = buildChildEnv({}, hostEnvFixture());
  assert.equal(result.PATH, "/usr/bin:/bin");
  assert.equal(result.HOME, "/home/test");
  assert.equal(result.TMPDIR, "/tmp");
  assert.equal(result.LANG, "en_US.UTF-8");
  assert.equal(result.HTTPS_PROXY, "http://proxy.local:8080");
  assert.equal(result.NODE_EXTRA_CA_CERTS, "/etc/ssl/custom.pem");
});

test("LC_ prefix is retained", () => {
  const result = buildChildEnv({}, hostEnvFixture());
  assert.equal(result.LC_ALL, "en_US.UTF-8");
  assert.equal(result.LC_CTYPE, "en_US.UTF-8");
});

test("inherit none yields an empty base", () => {
  const result = buildChildEnv({ inherit: "none" }, hostEnvFixture());
  assert.deepEqual(result, {});
  assert.equal(result.PATH, undefined);
});

test("passthrough exact name", () => {
  const withVar = buildChildEnv(
    { inherit: "none", passthrough: ["MY_VAR"] },
    hostEnvFixture({ MY_VAR: "value" }),
  );
  assert.equal(withVar.MY_VAR, "value");

  const withoutVar = buildChildEnv(
    { inherit: "none", passthrough: ["MY_VAR"] },
    hostEnvFixture(),
  );
  assert.equal(withoutVar.MY_VAR, undefined);
});

test("passthrough prefix wildcard", () => {
  const result = buildChildEnv(
    { inherit: "none", passthrough: ["NPM_CONFIG_*"] },
    hostEnvFixture({ NPM_CONFIG_REGISTRY: "https://registry.local", NPMX_FOO: "leak" }),
  );
  assert.equal(result.NPM_CONFIG_REGISTRY, "https://registry.local");
  assert.equal(result.NPMX_FOO, undefined);
});

test("explicit env overrides inherited value", () => {
  const result = buildChildEnv({ env: { PATH: "/custom" } }, hostEnvFixture());
  assert.equal(result.PATH, "/custom");
});

test("explicit env with undefined value deletes the key", () => {
  const result = buildChildEnv({ env: { PATH: undefined } }, hostEnvFixture());
  assert.equal("PATH" in result, false);
});

test("does not read global process.env", () => {
  const originalPath = process.env.TEST_LEAK_CHECK;
  process.env.TEST_LEAK_CHECK = "leaked";
  try {
    const result = buildChildEnv({}, hostEnvFixture());
    assert.equal(result.TEST_LEAK_CHECK, undefined);
  } finally {
    if (originalPath === undefined) {
      delete process.env.TEST_LEAK_CHECK;
    } else {
      process.env.TEST_LEAK_CHECK = originalPath;
    }
  }
});
