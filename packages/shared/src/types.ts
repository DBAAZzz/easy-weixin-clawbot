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

export type AccountStatusFilter = "all" | "active" | "deprecated";

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
  installedAt?: string;
  filePath?: string;
  runtimeKind?: "knowledge-only" | "python-script" | "python-script-set" | "node-script" | "node-script-set" | "manual-needed";
  entrypointPath?: string;
  dependencyNames?: string[];
  scriptSet?: string[];
  hasRuntime?: boolean;
  provisionStatus?: "pending" | "provisioning" | "ready" | "failed";
  provisionError?: string;
}

export interface SkillLocalRunCheckItem {
  status: "ok" | "fail" | "info";
  message: string;
}

export interface SkillLocalRunCheck {
  canRunNow: boolean;
  checks: SkillLocalRunCheckItem[];
}

export interface SkillUploadResult extends SkillInfo {
  localRunCheck?: SkillLocalRunCheck;
}

export interface SkillProvisionPlan {
  runtime: "python" | "node";
  installer: "uv-pip" | "pip" | "npm" | "pnpm" | "yarn" | "manual";
  createEnv: boolean;
  commandPreview: string[];
  dependencies: Array<{
    name: string;
    installSpec?: string;
    source: "markdown-install" | "import-scan";
    confidence: "high" | "medium" | "low";
  }>;
}

export interface SkillProvisionLog {
  level: "info" | "warn" | "error";
  message: string;
  timestamp: number;
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
  pending_trace_writes: number;
}

export type ObservabilityWindow = "24h" | "7d" | "30d";

export interface ObservabilityOverview {
  window: ObservabilityWindow;
  totals: {
    requests: number;
    avg_duration_ms: number;
    error_rate: number;
    token_total: number;
    estimated_cost_usd: number;
    sampled_traces: number;
  };
  latency_ms: {
    p50: number;
    p95: number;
    p99: number;
  };
  round_distribution: Array<{
    bucket: string;
    count: number;
    ratio: number;
  }>;
  top_tools: Array<{
    tool_name: string;
    count: number;
    ratio: number;
    error_rate: number;
    p95_ms: number;
  }>;
  flag_counts: Array<{
    flag: "error" | "max_rounds" | "slow" | "expensive";
    count: number;
    ratio: number;
  }>;
}

export interface ObservabilityTraceSummary {
  id: number;
  trace_id: string;
  account_id: string;
  conversation_id: string;
  total_ms: number;
  llm_rounds: number;
  tool_calls: number;
  input_tokens: number;
  output_tokens: number;
  stop_reason: string;
  error: string | null;
  flags: string[];
  sampled: boolean;
  created_at: string;
}

export type ObservabilitySpanAttributeValue = string | number | boolean;

export interface ObservabilitySpanPayload {
  prompt: string;
  completion: string;
}

export interface ObservabilityTraceSpan {
  id: number;
  trace_id: string;
  span_id: string;
  parent_span_id: string | null;
  name: string;
  start_time: string;
  duration_ms: number;
  status: "ok" | "error";
  tool_name: string | null;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  stop_reason: string | null;
  error_message: string | null;
  attributes: Record<string, ObservabilitySpanAttributeValue>;
  payload: ObservabilitySpanPayload | null;
}

export interface ObservabilityTraceDetail extends ObservabilityTraceSummary {
  spans: ObservabilityTraceSpan[];
}

export type TapeGraphCategory = "fact" | "preference" | "decision";
export type TapeGraphScope = "global" | "session";
export type TapeGraphEdgeType = "co_occurrence" | "prefix_cluster";

export interface TapeGraphNode {
  id: string;
  key: string;
  label: string;
  category: TapeGraphCategory;
  value: unknown;
  confidence?: number;
  scope: TapeGraphScope;
  branch: string;
  sourceEid: string;
  updatedAt: string;
}

export interface TapeGraphEdge {
  source: string;
  target: string;
  type: TapeGraphEdgeType;
  weight: number;
}

export interface TapeGraphGroup {
  id: string;
  label: string;
  type: "group";
  branch: string;
  children: string[];
}

export interface TapeGraphResponse {
  nodes: TapeGraphNode[];
  edges: TapeGraphEdge[];
  groups: TapeGraphGroup[];
  meta: {
    accountId: string;
    branch: string;
    totalEntries: number;
    generatedAt: string;
  };
}

// ── Model Config ────────────────────────────────────────────────────

export interface ModelProviderTemplateDto {
  id: string;
  name: string;
  provider: string;
  model_ids: string[];
  api_key_set: boolean;
  base_url: string | null;
  enabled: boolean;
  usage_count: number;
}

export interface ModelProviderTemplatePingDto {
  template_id: string;
  provider: string;
  reachable: boolean;
  status_code: number | null;
  latency_ms: number | null;
  checked_at: string;
  endpoint: string | null;
  message: string;
  model_count: number | null;
}

export interface ModelConfigDto {
  id: string; // BigInt serialized as string
  scope: "global" | "account" | "conversation";
  scope_key: string;
  purpose: string; // "chat" | "extraction" | "*"
  template_id: string;
  template_name: string;
  provider: string;
  model_id: string;
  template_enabled: boolean;
  enabled: boolean;
  priority: number;
}
