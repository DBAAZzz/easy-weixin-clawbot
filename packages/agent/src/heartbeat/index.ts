export {
  startHeartbeat,
  stopHeartbeat,
  checkWaitingGoalsAsync,
} from "./engine.js";

export {
  heartbeatToolRegistry,
  setHeartbeatToolContext,
  setHeartbeatContext,
  isHeartbeatContext,
} from "./tool.js";

export { evaluateGoal } from "./evaluator.js";
export { reasonInternal } from "./reason-internal.js";

export type {
  GoalStatus,
  GoalOrigin,
  Verdict,
  PendingGoalRow,
  CreateGoalInput,
  UpdateGoalInput,
  GoalTransition,
  HeartbeatExecutionRequest,
  HeartbeatExecutionResult,
} from "./types.js";
export { LIMITS, INITIAL_BACKOFF_MS, MAX_BACKOFF_MS, nextBackoff } from "./types.js";
