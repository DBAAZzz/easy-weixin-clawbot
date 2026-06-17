import { useDeferredValue, useEffect, useState } from "react";
import { useTools } from "../../hooks/useTools.js";

export function useToolsPage() {
  const { tools, loading, error, refresh } = useTools();
  const [query, setQuery] = useState("");
  const [activeToolName, setActiveToolName] = useState<string | null>(null);
  const deferredQuery = useDeferredValue(query);
  const normalizedQuery = deferredQuery.trim().toLowerCase();
  const filteredTools = tools.filter((tool) => {
    if (!normalizedQuery) return true;

    return [tool.name, tool.description, tool.handler, tool.origin, ...tool.parameterNames].some(
      (value) => value.toLowerCase().includes(normalizedQuery),
    );
  });
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
  const handlerCount = new Set(tools.map((tool) => tool.handler)).size;

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
    filteredTools,
    activeTool,
    enabledCount,
    handlerCount,
    handleRefresh,
  };
}
