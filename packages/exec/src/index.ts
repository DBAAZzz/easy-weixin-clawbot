/**
 * @clawbot/exec —— 仓库内 child_process 的唯一合法入口。
 *
 * 职责边界：只管「怎么起进程」（env 白名单、spawn、超时、maxBuffer、进程组清杀）。
 * 不管依赖供给（provisioner 逻辑留在 agent 包）、不管「何时起/何时收」（调度留在调用方）。
 *
 * 非目标：不做容器/microVM/seccomp/cgroup 沙箱；不做 CPU/PID 硬限额（不可移植）；
 * 不做 MCP 按需启动/空闲回收。防的是「第三方包默认继承全部凭据」的被动泄露，
 * 不防「同 UID 恶意代码主动翻文件系统」——后者在不引入容器的前提下无解。
 *
 * 详见 docs/2026-07-23_21_30_exec-package-design.md。
 */
export { buildChildEnv, INSTALLER_ENV_PASSTHROUGH } from "./env-policy.js";
export { run } from "./run.js";
export { spawnService } from "./service.js";
export type {
  EnvInherit,
  EnvSpec,
  RejectOnError,
  RunResult,
  RunSpec,
  ServiceExit,
  ServiceHandle,
  ServiceSpec,
} from "./types.js";
