export interface ModelProviderPreset {
  label: string;
  provider: string;
  description: string;
  baseUrlPlaceholder?: string;
  suggestedModelIds?: string[];
}

export const MODEL_PROVIDER_PRESETS: ModelProviderPreset[] = [
  {
    label: "OpenAI",
    provider: "openai",
    description: "GPT 系列与通用 OpenAI 兼容模型",
    baseUrlPlaceholder: "https://api.openai.com/v1",
    suggestedModelIds: ["gpt-5", "gpt-5-mini", "gpt-4.1"],
  },
  {
    label: "Anthropic",
    provider: "anthropic",
    description: "Claude 系列对话模型",
    suggestedModelIds: ["claude-sonnet-4-20250514", "claude-3-7-sonnet-latest"],
  },
  {
    label: "Google Gemini",
    provider: "google",
    description: "Gemini 系列模型",
    suggestedModelIds: ["gemini-2.5-pro", "gemini-2.5-flash"],
  },
  {
    label: "DeepSeek",
    provider: "deepseek",
    description: "DeepSeek 官方模型",
    baseUrlPlaceholder: "https://api.deepseek.com/v1",
    suggestedModelIds: ["deepseek-chat", "deepseek-reasoner"],
  },
  {
    label: "Moonshot",
    provider: "moonshot",
    description: "Moonshot 中国大陆端点",
    baseUrlPlaceholder: "https://api.moonshot.cn/v1",
    suggestedModelIds: ["moonshot-v1-8k", "moonshot-v1-32k", "moonshot-v1-128k"],
  },
  {
    label: "Kimi",
    provider: "kimi",
    description: "Kimi 国际版端点",
    baseUrlPlaceholder: "https://api.kimi.ai/v1",
    suggestedModelIds: ["kimi-k2.5", "kimi-latest"],
  },
  {
    label: "OpenRouter",
    provider: "openrouter",
    description: "聚合多模型供应商",
    baseUrlPlaceholder: "https://openrouter.ai/api/v1",
    suggestedModelIds: ["openai/gpt-4o", "anthropic/claude-3.7-sonnet", "deepseek/deepseek-chat"],
  },
  {
    label: "Azure OpenAI",
    provider: "azure-openai",
    description: "Azure 托管 OpenAI 兼容端点",
  },
  {
    label: "Custom",
    provider: "",
    description: "手动输入 provider 与 base URL",
  },
];
