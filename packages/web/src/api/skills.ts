import type { SkillInfo, MarkdownSource } from "@clawbot/shared";
import { request } from "./core/client";

export function fetchSkills(): Promise<SkillInfo[]> {
  return request<SkillInfo[]>("/api/skills");
}

export function fetchSkillSource(name: string): Promise<MarkdownSource> {
  return request<MarkdownSource>(`/api/skills/${encodeURIComponent(name)}/source`);
}

export function installSkill(markdown: string): Promise<SkillInfo> {
  return request<SkillInfo>("/api/skills", {
    method: "POST",
    body: JSON.stringify({ markdown }),
  });
}

export function updateSkill(name: string, markdown: string): Promise<SkillInfo> {
  return request<SkillInfo>(`/api/skills/${encodeURIComponent(name)}`, {
    method: "PUT",
    body: JSON.stringify({ markdown }),
  });
}

export function enableSkill(name: string): Promise<SkillInfo> {
  return request<SkillInfo>(`/api/skills/${encodeURIComponent(name)}/enable`, {
    method: "POST",
    body: "{}",
  });
}

export function disableSkill(name: string): Promise<SkillInfo> {
  return request<SkillInfo>(`/api/skills/${encodeURIComponent(name)}/disable`, {
    method: "POST",
    body: "{}",
  });
}

export function removeSkill(name: string): Promise<{ name: string }> {
  return request<{ name: string }>(`/api/skills/${encodeURIComponent(name)}`, {
    method: "DELETE",
  });
}
