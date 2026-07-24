import type { ToolRegistry, ToolSnapshot, ToolSnapshotItem } from "./types.js";

const EMPTY_SNAPSHOT: ToolSnapshot = {
  tools: [],
};

function findToolOwner(
  registries: readonly ToolRegistry[],
  name: string,
): ToolRegistry | undefined {
  return registries.find((registry) =>
    registry.current().tools.some((tool) => tool.name === name),
  );
}

function mergeSnapshots(registries: readonly ToolRegistry[]): ToolSnapshot {
  const tools: ToolSnapshotItem[] = [];
  const seen = new Set<string>();

  // 合并顺序即优先级：local、MCP、scheduler、heartbeat、skill runtime 等 registry 可并列暴露给模型。
  // 同名 tool 只保留第一个，防止后注册来源意外覆盖基础能力。
  for (const registry of registries) {
    for (const tool of registry.current().tools) {
      if (seen.has(tool.name)) {
        console.warn(`[tool-registry] tool name conflict: "${tool.name}" already registered, skipping duplicate`);
        continue;
      }

      seen.add(tool.name);
      tools.push(tool);
    }
  }

  return tools.length > 0 ? { tools } : EMPTY_SNAPSHOT;
}

export function createCompositeToolRegistry(...registries: ToolRegistry[]): ToolRegistry {
  return {
    swap() {
      throw new Error("Composite tool registry cannot be swapped directly");
    },

    current() {
      return mergeSnapshots(registries);
    },

    async execute(name, args, ctx) {
      // 执行时重新定位 owner，保证某个子 registry swap 后 composite 不需要维护额外缓存。
      const owner = findToolOwner(registries, name);
      if (!owner) {
        throw new Error(`Unknown tool: ${name}`);
      }

      return owner.execute(name, args, ctx);
    },
  };
}
