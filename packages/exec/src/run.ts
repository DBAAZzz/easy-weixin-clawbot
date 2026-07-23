import { spawn } from "node:child_process";
import { buildChildEnv } from "./env-policy.js";
import { killProcessGroup } from "./kill.js";
import type { RunResult, RunSpec } from "./types.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_BUFFER = 4 * 1024 * 1024;
const KILL_ESCALATION_MS = 2_000;

function createAbortError(): Error {
  const error = new Error("The operation was aborted");
  error.name = "AbortError";
  return error;
}

/**
 * 不用 execFile：需要 detached + 组杀 + 统一错误形状，execFile 的 timeout/killSignal 只作用于直接子进程。
 */
export function run(spec: RunSpec): Promise<RunResult> {
  const timeoutMs = spec.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBuffer = spec.maxBuffer ?? DEFAULT_MAX_BUFFER;
  const rejectOnError = spec.rejectOnError ?? "always";

  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    return Promise.reject(
      new Error(`timeoutMs must be a positive integer, got ${String(spec.timeoutMs)}`),
    );
  }

  return new Promise<RunResult>((resolve, reject) => {
    if (spec.signal?.aborted) {
      reject(createAbortError());
      return;
    }

    let settled = false;
    let stdout = "";
    let stderr = "";
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    let aborted = false;
    let maxBufferExceeded: "stdout" | "stderr" | null = null;
    let escalateTimer: NodeJS.Timeout | undefined;

    const child = spawn(spec.binary, spec.args as string[], {
      cwd: spec.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
      env: buildChildEnv(spec),
    });

    const killTimer = setTimeout(() => {
      timedOut = true;
      killWithEscalation("SIGTERM");
    }, timeoutMs);

    function onAbort() {
      if (settled) return;
      aborted = true;
      killWithEscalation("SIGTERM");
    }

    if (spec.signal) {
      spec.signal.addEventListener("abort", onAbort, { once: true });
    }

    function killWithEscalation(signal: NodeJS.Signals) {
      killProcessGroup(child.pid, signal);
      escalateTimer = setTimeout(() => {
        killProcessGroup(child.pid, "SIGKILL");
      }, KILL_ESCALATION_MS);
    }

    function cleanup() {
      clearTimeout(killTimer);
      if (escalateTimer) clearTimeout(escalateTimer);
      if (spec.signal) spec.signal.removeEventListener("abort", onAbort);
    }

    child.stdout!.setEncoding("utf8");
    child.stderr!.setEncoding("utf8");

    child.stdout!.on("data", (chunk: string) => {
      if (maxBufferExceeded) return;
      stdoutBytes += Buffer.byteLength(chunk, "utf8");
      if (stdoutBytes > maxBuffer) {
        maxBufferExceeded = "stdout";
        killProcessGroup(child.pid, "SIGKILL");
        return;
      }
      stdout += chunk;
    });

    child.stderr!.on("data", (chunk: string) => {
      if (maxBufferExceeded) return;
      stderrBytes += Buffer.byteLength(chunk, "utf8");
      if (stderrBytes > maxBuffer) {
        maxBufferExceeded = "stderr";
        killProcessGroup(child.pid, "SIGKILL");
        return;
      }
      stderr += chunk;
    });

    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`${spec.binary} failed to start: ${error.message}`));
    });

    // 在 exit（而非 close）时收尾是刻意取舍：close 需等 stdio 流全部关闭，若孙进程继承管道
    // 不退出，会拖到超时才触发；代价是理论上可能丢失 exit 后仍滞留在管道里的尾部输出
    // （Node 22 / darwin 下 16MiB 一次性写入未复现）。
    child.once("exit", (code, signalName) => {
      if (settled) return;
      settled = true;
      cleanup();

      if (maxBufferExceeded) {
        reject(new Error(`${spec.binary} output exceeded maxBuffer (${maxBuffer} bytes)`));
        return;
      }
      if (aborted) {
        reject(createAbortError());
        return;
      }
      if (timedOut) {
        reject(new Error(`${spec.binary} timed out after ${timeoutMs}ms`));
        return;
      }

      const result: RunResult = { stdout, stderr, code, signal: signalName };
      const failed = code !== 0 || signalName !== null;

      if (!failed) {
        resolve(result);
        return;
      }

      const shouldReject =
        rejectOnError === "always" ||
        (rejectOnError === "when-empty-output" && !stdout && !stderr);

      if (shouldReject) {
        reject(
          new Error(`${spec.binary} ${spec.args.join(" ")} failed: ${stderr || `exit code ${code}`}`),
        );
        return;
      }

      resolve(result);
    });
  });
}
