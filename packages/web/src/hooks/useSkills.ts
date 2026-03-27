import { useState } from "react";
import type { SkillInfo } from "@clawbot/shared";
import {
  disableSkill,
  enableSkill,
  fetchSkills,
  installSkill,
  removeSkill,
  updateSkill,
} from "../lib/api.js";
import { useAsyncResource } from "./use-async-resource.js";

export function useSkills() {
  const [revision, setRevision] = useState(0);
  const resource = useAsyncResource<SkillInfo[]>(() => fetchSkills(), [revision]);

  return {
    skills: resource.data ?? [],
    loading: resource.loading,
    error: resource.error,
    async install(markdown: string) {
      const result = await installSkill(markdown);
      setRevision((value) => value + 1);
      return result;
    },
    async update(name: string, markdown: string) {
      const result = await updateSkill(name, markdown);
      setRevision((value) => value + 1);
      return result;
    },
    async enable(name: string) {
      const result = await enableSkill(name);
      setRevision((value) => value + 1);
      return result;
    },
    async disable(name: string) {
      const result = await disableSkill(name);
      setRevision((value) => value + 1);
      return result;
    },
    async remove(name: string) {
      const result = await removeSkill(name);
      setRevision((value) => value + 1);
      return result;
    },
    refresh() {
      setRevision((value) => value + 1);
    },
  };
}
