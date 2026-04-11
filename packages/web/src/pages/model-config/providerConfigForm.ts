import type { ModelProviderTemplateDto } from "@clawbot/shared";
import {
  MODEL_PROVIDER_PRESETS,
  type ModelProviderPreset,
} from "./providerPresets.js";
import { createEditableModelIdList } from "./templateForm.js";

export interface ProviderConfigFormState {
  name: string;
  provider: string;
  modelIds: string[];
  apiKey: string;
  baseUrl: string;
  enabled: boolean;
  clearApiKey: boolean;
  apiKeySet: boolean;
  baseUrlPlaceholder?: string;
}

export const EMPTY_PROVIDER_CONFIG_FORM: ProviderConfigFormState = {
  name: "",
  provider: "",
  modelIds: [""],
  apiKey: "",
  baseUrl: "",
  enabled: true,
  clearApiKey: false,
  apiKeySet: false,
};

export function createProviderConfigForm(
  preset?: ModelProviderPreset,
): ProviderConfigFormState {
  return {
    ...EMPTY_PROVIDER_CONFIG_FORM,
    name: preset ? `${preset.label} 供应商配置` : "",
    provider: preset?.provider ?? "",
    modelIds: createEditableModelIdList(preset?.suggestedModelIds ?? []),
    baseUrl: "",
    baseUrlPlaceholder: preset?.baseUrlPlaceholder,
  };
}

export function createProviderConfigFormFromDto(
  template: ModelProviderTemplateDto,
): ProviderConfigFormState {
  const preset = MODEL_PROVIDER_PRESETS.find(
    (item) => item.provider === template.provider,
  );

  return {
    name: template.name,
    provider: template.provider,
    modelIds: createEditableModelIdList(template.model_ids),
    apiKey: "",
    baseUrl: template.base_url ?? "",
    enabled: template.enabled,
    clearApiKey: false,
    apiKeySet: template.api_key_set,
    baseUrlPlaceholder: preset?.baseUrlPlaceholder,
  };
}
