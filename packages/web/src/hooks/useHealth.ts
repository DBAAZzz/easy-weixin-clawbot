import { useState } from "react";
import type { HealthStatus } from "@clawbot/shared";
import { fetchHealth } from "../lib/api.js";
import { useAsyncResource } from "./use-async-resource.js";

export function useHealth() {
  const [revision, setRevision] = useState(0);
  const resource = useAsyncResource<HealthStatus>(() => fetchHealth(), [revision]);

  return {
    health: resource.data,
    loading: resource.loading,
    error: resource.error,
    refresh() {
      setRevision((value) => value + 1);
    },
  };
}
