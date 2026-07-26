import type { ToolRegistry, ToolSnapshot } from "./types.js";

const EMPTY_SNAPSHOT: ToolSnapshot = {
  tools: [],
};

export function createToolRegistry(initialSnapshot: ToolSnapshot = EMPTY_SNAPSHOT): ToolRegistry {
  let snapshot = initialSnapshot;

  return {
    swap(nextSnapshot) {
      // 原子替换快照，避免在安装/禁用 tool 时原地修改数组影响正在运行的对话。
      snapshot = nextSnapshot;
    },

    current() {
      return snapshot;
    },

    async execute(name, args, ctx) {
      // execute 总是基于当前快照查找；runner 在发起模型调用前也会读取同一份 schema。
      const tool = snapshot.tools.find((item) => item.name === name);
      if (!tool) {
        throw new Error(`Unknown tool: ${name}`);
      }

      return tool.execute(args, ctx);
    },
  };
}
