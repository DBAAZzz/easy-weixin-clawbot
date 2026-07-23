import { execFile, spawn } from "node:child_process";
import { buildChildEnv } from "./env-policy.js";
import { killProcessGroup } from "./kill.js";
import type { ServiceExit, ServiceHandle, ServiceSpec } from "./types.js";

const DEFAULT_GRACEFUL_TIMEOUT_MS = 5_000;
const DEFAULT_MEMORY_POLL_INTERVAL_MS = 30_000;
const MEMORY_OVER_LIMIT_STRIKES = 2;

/**
 * 读取直接子进程的 RSS（KiB）。macOS/Linux 通用；win32 下不调用本函数。
 * 只监控直接子进程，不含孙进程——这是看门狗的已知局限。
 */
function readRssKb(pid: number): Promise<number | null> {
  return new Promise((resolve) => {
    execFile("ps", ["-o", "rss=", "-p", String(pid)], (error, stdout) => {
      if (error) {
        resolve(null);
        return;
      }
      const value = Number.parseInt(stdout.trim(), 10);
      resolve(Number.isFinite(value) ? value : null);
    });
  });
}

export function spawnService(spec: ServiceSpec): ServiceHandle {
  const gracefulTimeoutMs = spec.gracefulTimeoutMs ?? DEFAULT_GRACEFUL_TIMEOUT_MS;

  const child = spawn(spec.command, spec.args ? [...spec.args] : [], {
    cwd: spec.cwd,
    stdio: "pipe",
    detached: process.platform !== "win32",
    env: buildChildEnv(spec),
  });

  let settled = false;
  let resolveExited!: (exit: ServiceExit) => void;
  const exited = new Promise<ServiceExit>((resolve) => {
    resolveExited = resolve;
  });

  let memoryWatchdogTimer: NodeJS.Timeout | undefined;
  let overLimitStrikes = 0;

  function stopMemoryWatchdog() {
    if (memoryWatchdogTimer) {
      clearInterval(memoryWatchdogTimer);
      memoryWatchdogTimer = undefined;
    }
  }

  function settle(exit: ServiceExit) {
    if (settled) return;
    settled = true;
    stopMemoryWatchdog();
    resolveExited(exit);
  }

  child.once("error", (error) => {
    settle({ code: null, signal: null, spawnError: error });
  });

  child.once("exit", (code, signal) => {
    settle({ code, signal });
  });

  async function checkMemory(limitMb: number): Promise<void> {
    const pid = child.pid;
    if (pid === undefined) return;
    const rssKb = await readRssKb(pid);
    if (rssKb === null) return;
    const rssMb = rssKb / 1024;
    if (rssMb <= limitMb) {
      overLimitStrikes = 0;
      return;
    }
    overLimitStrikes += 1;
    if (overLimitStrikes >= MEMORY_OVER_LIMIT_STRIKES) {
      spec.logger?.(
        "warn",
        `child process RSS ${rssMb.toFixed(1)}MiB exceeds memoryLimitMb=${limitMb}; stopping`,
      );
      void stop();
    }
  }

  if (spec.memoryLimitMb !== undefined && process.platform !== "win32") {
    const pollIntervalMs = spec.memoryPollIntervalMs ?? DEFAULT_MEMORY_POLL_INTERVAL_MS;
    const limitMb = spec.memoryLimitMb;
    memoryWatchdogTimer = setInterval(() => {
      void checkMemory(limitMb);
    }, pollIntervalMs);
  }

  let stopPromise: Promise<ServiceExit> | undefined;

  function stop(): Promise<ServiceExit> {
    if (stopPromise) return stopPromise;
    stopPromise = (async () => {
      if (settled) return exited;
      killProcessGroup(child.pid, "SIGTERM");
      const gracefulExit = await Promise.race([
        exited.then(() => true),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), gracefulTimeoutMs)),
      ]);
      if (!gracefulExit) {
        killProcessGroup(child.pid, "SIGKILL");
      }
      return exited;
    })();
    return stopPromise;
  }

  return {
    get pid() {
      return child.pid;
    },
    stdin: child.stdin!,
    stdout: child.stdout!,
    stderr: child.stderr!,
    exited,
    kill(signal: NodeJS.Signals = "SIGTERM") {
      killProcessGroup(child.pid, signal);
    },
    stop,
  };
}
