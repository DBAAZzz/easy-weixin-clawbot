import { useDeferredValue, useEffect, useState } from "react";
import { formatCount } from "../../lib/format.js";
import { useTools } from "../../hooks/useTools.js";

export function useToolsPage() {
  const { tools, loading, error, refresh } = useTools();
  const [query, setQuery] = useState("");
  const [activeToolName, setActiveToolName] = useState<string | null>(null);
  const [onlyEnabled, setOnlyEnabled] = useState(false);
  const deferredQuery = useDeferredValue(query);
  const normalizedQuery = deferredQuery.trim().toLowerCase();
  const queryFilteredTools = tools.filter((tool) => {
    if (!normalizedQuery) {
      return true;
    }

    return [tool.name, tool.description, tool.origin, ...tool.parameterNames].some((value) =>
      value.toLowerCase().includes(normalizedQuery),
    );
  });
  const filteredTools = queryFilteredTools.filter((tool) => !onlyEnabled || tool.enabled);
  const activeTool = tools.find((tool) => tool.name === activeToolName) ?? null;

  useEffect(() => {
    if (!activeToolName) return;

    if (!tools.some((tool) => tool.name === activeToolName)) {
      setActiveToolName(null);
    }
  }, [activeToolName, tools]);

  useEffect(() => {
    if (!activeToolName) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setActiveToolName(null);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeToolName]);

  const enabledCount = tools.filter((tool) => tool.enabled).length;
  const parameterCount = tools.reduce((sum, tool) => sum + tool.parameterNames.length, 0);
  const builtinCount = tools.filter((tool) => tool.origin === "builtin").length;
  const stats = [
    {
      label: "已安装",
      value: formatCount(tools.length),
      meta: "个工具",
      dotClassName: "bg-account-success-dot",
      valueClassName: "text-account-ink",
    },
    {
      label: "已启用",
      value: formatCount(enabledCount),
      meta: "当前可用",
      dotClassName: "bg-account-success-dot",
      valueClassName: "text-account-ink",
    },
    {
      label: "参数",
      value: formatCount(parameterCount),
      meta: "已声明",
      dotClassName: "bg-account-warning-dot",
      valueClassName: "text-account-ink",
    },
    {
      label: "代码内置",
      value: formatCount(builtinCount),
      meta: "来源",
      dotClassName: "bg-account-success-dot",
      valueClassName: "text-account-ink",
    },
  ];

  function handleRefresh() {
    refresh();
  }

  return {
    tools,
    loading,
    error,
    query,
    setQuery,
    activeToolName,
    setActiveToolName,
    onlyEnabled,
    setOnlyEnabled,
    filteredTools,
    activeTool,
    enabledCount,
    stats,
    handleRefresh,
  };
}
