import type { Readable, Writable } from "node:stream";

export type EnvInherit = "safe" | "none";

export interface EnvSpec {
  /**
   * "safe"（默认）：只继承 SAFE 白名单（PATH/HOME/代理等，见 env-policy.ts）。
   * "none"：完全空白起步。
   * 注意：不存在 "all"。需要额外变量用 passthrough 或 env 显式声明。
   */
  inherit?: EnvInherit;
  /** 额外继承的宿主变量名；尾部 "*" 表示前缀通配，如 "NPM_CONFIG_*"。 */
  passthrough?: readonly string[];
  /** 显式注入/覆盖，优先级最高；值为 undefined 表示删除该键。 */
  env?: Record<string, string | undefined>;
}

export type RejectOnError = "always" | "when-empty-output" | "never";

export interface RunSpec extends EnvSpec {
  binary: string;
  args: readonly string[];
  cwd?: string;
  /** 默认 30_000。必须为正整数；不允许「无超时」。 */
  timeoutMs?: number;
  /** stdout 与 stderr 各自的字节上限，默认 4 * 1024 * 1024。超限即杀并 reject。 */
  maxBuffer?: number;
  signal?: AbortSignal;
  /**
   * "always"（默认）：退出码非 0 或被信号杀死即 reject。
   * "when-empty-output"：仅当失败且 stdout、stderr 均为空时 reject。
   * "never"：只要进程退出就 resolve（超时/中止/maxBuffer 仍然 reject）。
   */
  rejectOnError?: RejectOnError;
}

export interface RunResult {
  stdout: string;
  stderr: string;
  code: number | null;
  signal: NodeJS.Signals | null;
}

export interface ServiceExit {
  code: number | null;
  signal: NodeJS.Signals | null;
  /** spawn 本身失败（如 ENOENT）时携带原始错误，此时 code/signal 均为 null。 */
  spawnError?: Error;
}

export interface ServiceSpec extends EnvSpec {
  command: string;
  args?: readonly string[];
  cwd?: string;
  /** stop() 的 SIGTERM→SIGKILL 宽限期，默认 5_000。 */
  gracefulTimeoutMs?: number;
  /** 注入的日志回调；不注入则静默。 */
  logger?: (level: "warn" | "error", message: string) => void;
  /** 可选 RSS 看门狗（§4.6）；不设置则关闭。 */
  memoryLimitMb?: number;
  /** RSS 采样间隔，默认 30_000。 */
  memoryPollIntervalMs?: number;
}

export interface ServiceHandle {
  readonly pid: number | undefined;
  readonly stdin: Writable;
  readonly stdout: Readable;
  readonly stderr: Readable;
  /** 进程结束（含 spawn 失败）时 resolve，永不 reject，只 settle 一次。 */
  readonly exited: Promise<ServiceExit>;
  /** 立即向整个进程组发信号，默认 SIGTERM。 */
  kill(signal?: NodeJS.Signals): void;
  /** SIGTERM → 等待 gracefulTimeoutMs → SIGKILL，resolve 于进程真正退出。幂等。 */
  stop(): Promise<ServiceExit>;
}
