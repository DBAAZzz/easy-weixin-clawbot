/**
 * Structured error hierarchy for the agent package.
 *
 * Replaces string-matched throw sites ("Execution timeout") with typed errors
 * so callers can branch with `instanceof` instead of brittle message matching.
 */

export class AgentError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "AgentError";
  }
}

/** Thrown when an operation exceeds its deadline. */
export class TimeoutError extends AgentError {
  constructor(message = "Execution timeout") {
    super(message, "EXECUTION_TIMEOUT");
    this.name = "TimeoutError";
  }
}

/** Thrown when LLM model resolution fails (no provider configured). */
export class ModelResolutionError extends AgentError {
  constructor(
    message: string,
    public readonly accountId: string,
    public readonly conversationId: string,
    public readonly purpose: string,
  ) {
    super(message, "MODEL_RESOLUTION_FAILED");
    this.name = "ModelResolutionError";
  }
}

/** Thrown when skill provision fails due to missing toolchain / dependency failure. */
export class SkillProvisionError extends AgentError {
  constructor(
    message: string,
    code: "TOOLCHAIN_MISSING" | "ENTRYPOINT_NOT_FOUND" | "DEPENDENCY_FAILED",
    public readonly skillName: string,
  ) {
    super(message, code);
    this.name = "SkillProvisionError";
  }
}
