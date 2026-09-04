import "../config/load-env.js";
import { disconnectPrisma } from "../db/prisma.js";
import { isDemoMode } from "../config/demo-mode.js";
import { seedDemoData } from "./demo-seed.js";

async function main(): Promise<void> {
  if (!isDemoMode()) {
    console.warn(
      "[demo-seed] DEMO_MODE 未开启，当前仅用于向演示环境写入数据。继续执行将写入 demo-wxid-* 前缀的演示数据。",
    );
  }

  const summary = await seedDemoData();
  if (summary) {
    console.log(
      `[demo-seed] 完成：账号 ${summary.accounts}，会话 ${summary.conversations}，消息 ${summary.messages}，定时任务 ${summary.scheduledTasks}`,
    );
  } else {
    console.log("[demo-seed] 演示数据已存在，本次跳过重建");
  }
}

try {
  await main();
} catch (error) {
  console.error("[demo-seed] 执行失败", error);
  process.exitCode = 1;
} finally {
  await disconnectPrisma();
}
