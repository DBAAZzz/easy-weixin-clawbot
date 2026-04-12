import type {
  ModelConfigDto,
  ModelProviderTemplateDto,
  ModelProviderTemplatePingDto,
} from "@clawbot/shared";
import { request } from "./core/client";

export function fetchModelConfigs(): Promise<ModelConfigDto[]> {
  return request<ModelConfigDto[]>("/api/model-configs");
}

export function fetchModelProviderTemplates(): Promise<ModelProviderTemplateDto[]> {
  return request<ModelProviderTemplateDto[]>("/api/model-provider-templates");
}

export function createModelProviderTemplate(payload: {
  name: string;
  provider: string;
  model_ids: string[];
  api_key?: string | null;
  base_url?: string | null;
  enabled?: boolean;
}): Promise<ModelProviderTemplateDto> {
  return request<ModelProviderTemplateDto>("/api/model-provider-templates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function updateModelProviderTemplate(
  id: string,
  payload: {
    name: string;
    provider: string;
    model_ids: string[];
    api_key?: string | null;
    clear_api_key?: boolean;
    base_url?: string | null;
    enabled?: boolean;
  },
): Promise<ModelProviderTemplateDto> {
  return request<ModelProviderTemplateDto>(
    `/api/model-provider-templates/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
}

export function deleteModelProviderTemplate(id: string): Promise<{ success: boolean }> {
  return request<{ success: boolean }>(`/api/model-provider-templates/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export function pingModelProviderTemplate(id: string): Promise<ModelProviderTemplatePingDto> {
  return request<ModelProviderTemplatePingDto>(
    `/api/model-provider-templates/${encodeURIComponent(id)}/ping`,
    {
      method: "POST",
      body: "{}",
    },
  );
}

export function upsertModelConfig(payload: {
  scope: "global" | "account" | "conversation";
  scope_key: string;
  purpose: string;
  template_id: string;
  model_id: string;
  enabled?: boolean;
  priority?: number;
}): Promise<ModelConfigDto> {
  return request<ModelConfigDto>("/api/model-configs", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function deleteModelConfig(id: string): Promise<{ success: boolean }> {
  return request<{ success: boolean }>(`/api/model-configs/${id}`, {
    method: "DELETE",
  });
}
