export function killProcessGroup(pid: number | undefined, signal: NodeJS.Signals): void {
  if (pid === undefined) return;
  if (process.platform !== "win32") {
    try {
      process.kill(-pid, signal); // 负 pid = 整个进程组
      return;
    } catch {
      // 进程组不存在（已退出）或权限问题，回退到单进程
    }
  }
  try {
    process.kill(pid, signal);
  } catch {
    // 已退出，忽略
  }
}
