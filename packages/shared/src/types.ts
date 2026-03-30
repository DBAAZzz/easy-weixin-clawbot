/** A single entry in a stored conversation (serialisable subset of pi-ai Message). */
export interface ConversationEntry {
  role: "user" | "assistant" | "toolResult";
  content: string;
  timestamp: number;
}

/** Shape that every custom tool must expose. */
export interface ToolDef {
  name: string;
  description: string;
  /** JSON Schema (TypeBox-compatible) for the tool parameters. */
  parameters: Record<string, unknown>;
  execute(args: Record<string, unknown>): Promise<string>;
}

export interface AccountRow {
  id: string;
  display_name: string | null;
  alias: string | null;
  deprecated: boolean;
  created_at: string;
}

export interface AccountSummary extends AccountRow {
  conversation_count: number;
}

export interface ConversationRow {
  id: number;
  account_id: string;
  account_alias: string | null;
  account_display_name: string | null;
  conversation_id: string;
  title: string | null;
  last_message_at: string | null;
  message_count: number;
  created_at: string;
}

export interface MessageRow {
  id: number;
  account_id: string;
  conversation_id: string;
  seq: number;
  role: "user" | "assistant" | "toolResult";
  content_text: string | null;
  payload: Record<string, unknown>;
  media_type: string | null;
  created_at: string;
}

export interface ApiResponse<T> {
  data?: T;
  error?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  has_more: boolean;
  next_cursor?: number;
}

export interface LegacySkillInfo {
  id: string;
  summary: string;
  version: string;
  author?: string;
  parameterNames: string[];
}

export interface ToolInfo {
  name: string;
  summary: string;
  version: string;
  author?: string;
  type: "tool";
  handler: string;
  origin: "builtin" | "user";
  enabled: boolean;
  parameterNames: string[];
}

export interface SkillInfo {
  name: string;
  summary: string;
  version: string;
  author?: string;
  type: "skill";
  activation: "always" | "on-demand";
  origin: "builtin" | "user";
  enabled: boolean;
}

export interface MarkdownSource {
  markdown: string;
}

export interface CapabilityCollection {
  tools: ToolInfo[];
  skills: SkillInfo[];
}

export type McpTransport = "stdio";

export type McpServerStatus =
  | "connected"
  | "connecting"
  | "disconnected"
  | "error";

export interface McpServerInfo {
  id: string;
  name: string;
  slug: string;
  transport: McpTransport;
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd: string | null;
  enabled: boolean;
  status: McpServerStatus;
  last_error: string | null;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
  tool_count: number;
}

export interface McpToolInfo {
  id: string;
  server_id: string;
  server_name: string;
  server_slug: string;
  remote_name: string;
  local_name: string;
  summary: string | null;
  input_schema: Record<string, unknown>;
  enabled: boolean;
  last_seen_at: string | null;
}

export type LoginState =
  | { status: "idle" }
  | { status: "qr_ready"; qr_text: string }
  | { status: "scanning"; qr_text?: string; message?: string }
  | { status: "done"; account_id: string }
  | { status: "expired" }
  | { status: "error"; message: string };

export interface HealthStatus {
  status: "ok";
  uptime_ms: number;
  started_at: string;
  running_accounts: string[];
  pending_message_writes: number;
}
