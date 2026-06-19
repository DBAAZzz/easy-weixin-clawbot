import type { TapeGraphNode } from "@clawbot/shared";
import { formatMemoryValue } from "../../components/memory/MemoryTooltip.js";

export function matchesQuery(node: TapeGraphNode, query: string) {
  if (!query) return true;

  const haystack = [node.label, node.key, node.branch, node.category, formatMemoryValue(node.value)]
    .join(" ")
    .toLowerCase();

  return haystack.includes(query);
}
