import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  disableSkill,
  enableSkill,
  fetchSkills,
  fetchSkillPreflight,
  installSkill,
  provisionSkill,
  reprovisionSkill,
  removeSkill,
  streamProvisionLogs,
  updateSkill,
  uploadSkillFile,
} from "@/api/skills.js";
import { queryKeys } from "../lib/query-keys.js";

export function useSkills() {
  const queryClient = useQueryClient();
  const { data, isPending, error } = useQuery({
    queryKey: queryKeys.skills,
    queryFn: fetchSkills,
  });

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: queryKeys.skills });
  }

  return {
    skills: data ?? [],
    loading: isPending,
    error: error instanceof Error ? error.message : error ? String(error) : null,
    async install(markdown: string) {
      const result = await installSkill(markdown);
      invalidate();
      return result;
    },
    async uploadFile(file: File) {
      const result = await uploadSkillFile(file);
      invalidate();
      return result;
    },
    async preflight(name: string) {
      return fetchSkillPreflight(name);
    },
    async provision(name: string) {
      const result = await provisionSkill(name);
      invalidate();
      return result;
    },
    async reprovision(name: string) {
      const result = await reprovisionSkill(name);
      invalidate();
      return result;
    },
    async streamProvision(name: string, handlers: Parameters<typeof streamProvisionLogs>[1]) {
      await streamProvisionLogs(name, handlers);
      invalidate();
    },
    async update(name: string, markdown: string) {
      const result = await updateSkill(name, markdown);
      invalidate();
      return result;
    },
    async enable(name: string) {
      const result = await enableSkill(name);
      invalidate();
      return result;
    },
    async disable(name: string) {
      const result = await disableSkill(name);
      invalidate();
      return result;
    },
    async remove(name: string) {
      const result = await removeSkill(name);
      invalidate();
      return result;
    },
    refresh: invalidate,
  };
}
