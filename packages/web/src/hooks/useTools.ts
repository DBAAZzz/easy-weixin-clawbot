import { useState } from "react";
import type { ToolInfo } from "@clawbot/shared";
import {
  disableTool,
  enableTool,
  fetchTools,
  installTool,
  removeTool,
  updateTool,
} from "../lib/api.js";
import { useAsyncResource } from "./use-async-resource.js";

export function useTools() {
  const [revision, setRevision] = useState(0);
  const resource = useAsyncResource<ToolInfo[]>(() => fetchTools(), [revision]);

  return {
    tools: resource.data ?? [],
    loading: resource.loading,
    error: resource.error,
    async install(markdown: string) {
      const result = await installTool(markdown);
      setRevision((value) => value + 1);
      return result;
    },
    async update(name: string, markdown: string) {
      const result = await updateTool(name, markdown);
      setRevision((value) => value + 1);
      return result;
    },
    async enable(name: string) {
      const result = await enableTool(name);
      setRevision((value) => value + 1);
      return result;
    },
    async disable(name: string) {
      const result = await disableTool(name);
      setRevision((value) => value + 1);
      return result;
    },
    async remove(name: string) {
      const result = await removeTool(name);
      setRevision((value) => value + 1);
      return result;
    },
    refresh() {
      setRevision((value) => value + 1);
    },
  };
}
