import type {
  SkillInfo,
  MarkdownSource,
  ApiResponse,
  SkillUploadResult,
  SkillProvisionPlan,
  SkillProvisionLog,
} from "@clawbot/shared";
import { request } from "./core/client";
import { getAuthToken, clearAuthAndRedirect } from "./core/auth";

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

export async function uploadSkillFile(file: File): Promise<SkillUploadResult> {
  const formData = new FormData();
  formData.append("file", file);

  const headers: Record<string, string> = {};
  const token = getAuthToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  // Do NOT set Content-Type — let the browser set multipart boundary automatically

  const response = await fetch("/api/skills/upload", {
    method: "POST",
    headers,
    body: formData,
  });

  if (response.status === 401) {
    clearAuthAndRedirect();
  }

  const payload = (await response.json().catch(() => ({ error: "invalid response" }))) as ApiResponse<SkillUploadResult>;
  if (!response.ok || payload.error) {
    throw new Error(payload.error ?? `upload failed with status ${response.status}`);
  }
  return payload.data as SkillUploadResult;
}

export function fetchSkillPreflight(name: string): Promise<SkillProvisionPlan> {
  return request<SkillProvisionPlan>(`/api/skills/${encodeURIComponent(name)}/preflight`);
}

export function provisionSkill(name: string): Promise<{ status: string; logs: SkillProvisionLog[] }> {
  return request<{ status: string; logs: SkillProvisionLog[] }>(
    `/api/skills/${encodeURIComponent(name)}/provision`,
    {
      method: "POST",
      body: "{}",
    },
  );
}

export function reprovisionSkill(name: string): Promise<{ status: string; logs: SkillProvisionLog[] }> {
  return request<{ status: string; logs: SkillProvisionLog[] }>(
    `/api/skills/${encodeURIComponent(name)}/reprovision`,
    {
      method: "POST",
      body: "{}",
    },
  );
}

export async function streamProvisionLogs(
  name: string,
  handlers: {
    onLog: (log: SkillProvisionLog) => void;
    onDone?: (status: { status: string }) => void;
    onError?: (error: { error: string }) => void;
  },
): Promise<void> {
  const headers: Record<string, string> = {};
  const token = getAuthToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`/api/skills/${encodeURIComponent(name)}/provision/logs`, {
    method: "GET",
    headers,
  });

  if (response.status === 401) {
    clearAuthAndRedirect();
  }
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({ error: "invalid response" }))) as {
      error?: string;
    };
    throw new Error(payload.error ?? `stream failed with status ${response.status}`);
  }
  if (!response.body) {
    throw new Error("SSE stream has no response body");
  }

  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let idx = buffer.indexOf("\n\n");
    while (idx >= 0) {
      const chunk = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 2);

      let eventName = "message";
      let data = "";
      for (const line of chunk.split("\n")) {
        if (line.startsWith("event:")) {
          eventName = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          data += line.slice(5).trim();
        }
      }

      if (eventName === "log" && data) {
        handlers.onLog(JSON.parse(data) as SkillProvisionLog);
      } else if (eventName === "done" && data) {
        handlers.onDone?.(JSON.parse(data) as { status: string });
      } else if (eventName === "error" && data) {
        handlers.onError?.(JSON.parse(data) as { error: string });
      }

      idx = buffer.indexOf("\n\n");
    }
  }
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
