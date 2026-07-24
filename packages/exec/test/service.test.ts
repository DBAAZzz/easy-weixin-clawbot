import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnService } from "../src/service.js";

function waitFor(predicate: () => boolean, timeoutMs = 3_000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      if (predicate()) {
        resolve();
        return;
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error("waitFor timed out"));
        return;
      }
      setTimeout(check, 20);
    };
    check();
  });
}

/** 等待子进程在 stdout 打印 "ready"，确保信号处理器已注册完毕再发信号，避免测试竞态。 */
function waitForReady(handle: { stdout: NodeJS.ReadableStream }): Promise<void> {
  return new Promise((resolve) => {
    handle.stdout.setEncoding("utf8");
    const onData = (chunk: string) => {
      if (chunk.includes("ready")) {
        handle.stdout.off("data", onData);
        resolve();
      }
    };
    handle.stdout.on("data", onData);
  });
}

test("stdin/stdout round trip", async () => {
  const handle = spawnService({
    command: process.execPath,
    args: ["-e", "process.stdin.on('data', (d) => process.stdout.write(d))"],
  });
  try {
    const output = await new Promise<string>((resolve) => {
      handle.stdout.setEncoding("utf8");
      handle.stdout.once("data", (chunk: string) => resolve(chunk));
      handle.stdin.write("hello\n");
    });
    assert.equal(output, "hello\n");
  } finally {
    await handle.stop();
  }
});

test("graceful stop resolves quickly on SIGTERM", async () => {
  const handle = spawnService({
    command: process.execPath,
    args: [
      "-e",
      "process.on('SIGTERM', () => process.exit(0));console.log('ready');setInterval(()=>{},1000)",
    ],
    gracefulTimeoutMs: 3_000,
  });
  await waitForReady(handle);
  const start = Date.now();
  const exit = await handle.stop();
  assert.equal(exit.code, 0);
  assert.ok(Date.now() - start < 2_000);
});

test("escalates to SIGKILL when the process ignores SIGTERM", async () => {
  const handle = spawnService({
    command: process.execPath,
    args: ["-e", "process.on('SIGTERM', () => {});console.log('ready');setInterval(()=>{},1000)"],
    gracefulTimeoutMs: 500,
  });
  await waitForReady(handle);
  const exit = await handle.stop();
  assert.equal(exit.signal, "SIGKILL");
});

test("stop kills the whole process group including grandchildren", async () => {
  const handle = spawnService({
    command: process.execPath,
    args: [
      "-e",
      `
      const { spawn } = require("child_process");
      const child = spawn("sleep", ["60"], { stdio: "ignore" });
      process.stdout.write(String(child.pid) + "\\n");
      setInterval(()=>{},1000);
      `,
    ],
  });
  handle.stdout.setEncoding("utf8");
  const grandchildPid = await new Promise<number>((resolve) => {
    handle.stdout.once("data", (chunk: string) => resolve(Number.parseInt(chunk.trim(), 10)));
  });

  await handle.stop();

  await assert.rejects(async () => {
    process.kill(grandchildPid, 0);
  });
});

test("spawn failure settles exited with spawnError", async () => {
  const handle = spawnService({ command: "definitely-not-a-binary-xyz" });
  const exit = await handle.exited;
  assert.ok(exit.spawnError);
  assert.equal(exit.code, null);
});

test("stop is idempotent", async () => {
  const handle = spawnService({
    command: process.execPath,
    args: ["-e", "process.on('SIGTERM', () => process.exit(0));setInterval(()=>{},1000)"],
  });
  await waitFor(() => handle.pid !== undefined);
  const [first, second] = await Promise.all([handle.stop(), handle.stop()]);
  assert.deepEqual(first, second);
});
