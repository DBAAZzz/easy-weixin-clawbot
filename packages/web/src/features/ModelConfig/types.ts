import type { SelectOption } from "@clawbot/ui";
import type {
  AccountSummary,
  ConversationRow,
  ModelConfigDto,
  ModelProviderTemplateDto,
  ModelProviderTemplatePingDto,
} from "../../../../shared/src/types.js";
import { parseScopeSelection } from "../model-config/configForm.js";

export const SCOPE_LABELS: Record<string, string> = {
  global: "全局",
  account: "账号级",
  conversation: "会话级",
};

export const PURPOSE_LABELS: Record<string, string> = {
  chat: "对话",
  extraction: "记忆提取",
  vision: "Vision 识图",
  "*": "全部",
};

export const VISION_OVERRIDE_LABELS: Record<string, string> = {
  default: "跟随系统默认",
  supported: "支持视觉输入",
  unsupported: "不支持视觉输入",
};

export const SCOPE_TONES: Record<string, "online" | "muted" | "warning"> = {
  global: "muted",
  account: "muted",
  conversation: "warning",
};

export interface ConfigEditorForm {
  scope: "global" | "account" | "conversation";
  scopeKey: string;
  accountId: string;
  conversationId: string;
  purpose: "*" | "chat" | "extraction" | "vision";
  templateId: string;
  modelId: string;
  supportsImageInputOverride: "default" | "supported" | "unsupported";
  enabled: boolean;
  priority: number;
}

export const EMPTY_CONFIG_FORM: ConfigEditorForm = {
  scope: "global",
  scopeKey: "*",
  accountId: "",
  conversationId: "",
  purpose: "*",
  templateId: "",
  modelId: "",
  supportsImageInputOverride: "default",
  enabled: true,
  priority: 0,
};

export interface ProviderPingState {
  phase: "idle" | "pending" | "resolved";
  result: ModelProviderTemplatePingDto | null;
}

export function createConfigFormFromDto(dto: ModelConfigDto): ConfigEditorForm {
  const selection = parseScopeSelection(dto.scope, dto.scope_key);
  return {
    scope: dto.scope,
    scopeKey: dto.scope_key,
    accountId: selection.accountId,
    conversationId: selection.conversationId,
    purpose: dto.purpose as ConfigEditorForm["purpose"],
    templateId: dto.template_id,
    modelId: dto.model_id,
    supportsImageInputOverride: dto.supports_image_input_override,
    enabled: dto.enabled,
    priority: dto.priority,
  };
}

export function createConfigForm(templates: ModelProviderTemplateDto[]): ConfigEditorForm {
  const firstTemplate = templates.find((template) => template.enabled);
  return {
    ...EMPTY_CONFIG_FORM,
    templateId: firstTemplate?.id ?? "",
  };
}

export function templateLabel(template: ModelProviderTemplateDto): string {
  return `${template.name} · ${template.provider}`;
}

export function accountLabel(account: AccountSummary): string {
  const name = account.alias?.trim() || account.display_name?.trim() || account.id;
  return name === account.id ? account.id : `${name} · ${account.id}`;
}

export function conversationLabel(conversation: ConversationRow): string {
  return conversation.title?.trim() || "未命名会话";
}

export function ensureSelectedOption(
  options: SelectOption[],
  value: string,
  label: string,
): SelectOption[] {
  if (!value || options.some((option) => option.value === value)) {
    return options;
  }

  return [...options, { value, label }];
}
