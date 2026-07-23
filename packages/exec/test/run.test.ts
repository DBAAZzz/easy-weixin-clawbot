import assert from "node:assert/strict";
import { test } from "node:test";
import { run } from "../src/run.js";

test("normal output resolves with stdout and code 0", async () => {
  const result = await run({
    binary: process.execPath,
    args: ["-e", "console.log('hi')"],
  });
  assert.match(result.stdout, /hi/);
  assert.equal(result.code, 0);
});

test("env isolation end to end: host secrets are not visible to child", async () => {
  process.env.TEST_LEAK_CHECK = "secret";
  try {
    const result = await run({
      binary: process.execPath,
      args: ["-e", "console.log(String(process.env.TEST_LEAK_CHECK))"],
    });
    assert.match(result.stdout, /undefined/);
  } finally {
    delete process.env.TEST_LEAK_CHECK;
  }
});

test("explicit env is injected into the child", async () => {
  const result = await run({
    binary: process.execPath,
    args: ["-e", "console.log(process.env.FOO)"],
    env: { FOO: "bar" },
  });
  assert.match(result.stdout, /bar/);
});

test("non-zero exit rejects by default (always)", async () => {
  await assert.rejects(
    run({ binary: process.execPath, args: ["-e", "process.exit(3)"] }),
    /failed/,
  );
});

test("non-zero exit resolves when-empty-output if stdout is non-empty", async () => {
  const result = await run({
    binary: process.execPath,
    args: ["-e", "console.log('x');process.exit(3)"],
    rejectOnError: "when-empty-output",
  });
  assert.equal(result.stdout.trim(), "x");
  assert.equal(result.code, 3);
});

test("non-zero exit resolves with never", async () => {
  const result = await run({
    binary: process.execPath,
    args: ["-e", "process.exit(3)"],
    rejectOnError: "never",
  });
  assert.equal(result.code, 3);
});

test("timeout rejects and kills the process", async () => {
  const start = Date.now();
  await assert.rejects(
    run({
      binary: process.execPath,
      args: ["-e", "setInterval(()=>{},1000)"],
      timeoutMs: 500,
    }),
    /timed out/,
  );
  assert.ok(Date.now() - start < 5_000);
});

test("already-aborted signal rejects immediately with AbortError", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    run({ binary: process.execPath, args: ["-e", "console.log('x')"], signal: controller.signal }),
    (error: Error) => error.name === "AbortError",
  );
});

test("aborting mid-run rejects with AbortError", async () => {
  const controller = new AbortController();
  const promise = run({
    binary: process.execPath,
    args: ["-e", "setInterval(()=>{},1000)"],
    signal: controller.signal,
  });
  setTimeout(() => controller.abort(), 50);
  await assert.rejects(promise, (error: Error) => error.name === "AbortError");
});

test("maxBuffer exceeded kills the process and rejects", async () => {
  await assert.rejects(
    run({
      binary: process.execPath,
      args: ["-e", "while(true){process.stdout.write('x'.repeat(1024))}"],
      maxBuffer: 1024,
    }),
    /maxBuffer/,
  );
});

test("spawn failure rejects with failed to start", async () => {
  await assert.rejects(
    run({ binary: "definitely-not-a-binary-xyz", args: [] }),
    /failed to start/,
  );
});

test("invalid timeoutMs rejects without spawning", async () => {
  await assert.rejects(
    run({ binary: process.execPath, args: ["-e", "0"], timeoutMs: 0 }),
    /timeoutMs must be a positive integer/,
  );
});
