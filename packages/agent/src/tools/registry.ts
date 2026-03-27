import type { ToolRegistry, ToolSnapshot } from "./types.js";

const EMPTY_SNAPSHOT: ToolSnapshot = {
  tools: [],
};

export function createToolRegistry(initialSnapshot: ToolSnapshot = EMPTY_SNAPSHOT): ToolRegistry {
  let snapshot = initialSnapshot;

  return {
    swap(nextSnapshot) {
      snapshot = nextSnapshot;
    },

    current() {
      return snapshot;
    },

    async execute(name, args, ctx) {
      const tool = snapshot.tools.find((item) => item.name === name);
      if (!tool) {
        throw new Error(`Unknown tool: ${name}`);
      }

      return tool.execute(args, ctx);
    },
  };
}
