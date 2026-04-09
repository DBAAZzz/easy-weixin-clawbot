export type GoalStatus =
  | "pending"
  | "checking"
  | "waiting_user"
  | "resolved"
  | "abandoned";

export type GoalOrigin =
  | "conversation"
  | "tool_failure"
  | "follow_up";

export type Verdict = "act" | "wait" | "resolve" | "abandon";

export interface PendingGoalRow {
  id: bigint;
  goalId: string;
  accountId: string;
  sourceConversationId: string;

  description: string;
  context: string;
  originType: string;
  originRef: string | null;

  status: string;

  nextCheckAt: Date;
  checkCount: number;
  maxChecks: number;
  backoffMs: number;

  latestSourceMessageSeq: number | null;
  resumeSignal: string | null;

  lastCheckAt: Date | null;
  lastCheckResult: string | null;
  resolution: string | null;

  totalInputTokens: number;
  totalOutputTokens: number;

  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date | null;
}

export interface CreateGoalInput {
  accountId: string;
  sourceConversationId: string;
  description: string;
  context: string;
  originType: GoalOrigin;
  originRef?: string;
  delayMs?: number;
  maxChecks?: number;
}

export interface UpdateGoalInput {
  status?: GoalStatus;
  nextCheckAt?: Date;
  checkCount?: number;
  backoffMs?: number;
  latestSourceMessageSeq?: number;
  resumeSignal?: string | null;
  lastCheckAt?: Date;
  lastCheckResult?: string;
  resolution?: string;
  totalInputTokens?: number;
  totalOutputTokens?: number;
}

export interface GoalTransition {
  goalId: string;
  newStatus: GoalStatus;
  updates: UpdateGoalInput;
  requestPush?: {
    accountId: string;
    conversationId: string;
    text: string;
  };
  requestExecution?: HeartbeatExecutionRequest;
}

export interface HeartbeatExecutionRequest {
  accountId: string;
  conversationId: string;
  prompt: string;
}

export interface HeartbeatExecutionResult {
  text?: string;
  status: "completed" | "error";
  error?: string;
}

export const LIMITS = {
  maxActiveGoalsPerAccount: 5,
  maxConcurrentChecks: 3,
  defaultMaxChecks: 10,
  goalHardExpiryMs: 7 * 24 * 3600_000,
  maxTokensPerGoal: 20_000,
  maxTokensPerHourPerAccount: 50_000,
  allowNestedGoalCreation: false,
} as const;

export const INITIAL_BACKOFF_MS = 5 * 60 * 1000;
export const MAX_BACKOFF_MS = 2 * 60 * 60 * 1000;
export const BACKOFF_MULTIPLIER = 3;

export function nextBackoff(current: number): number {
  return Math.min(current * BACKOFF_MULTIPLIER, MAX_BACKOFF_MS);
}
