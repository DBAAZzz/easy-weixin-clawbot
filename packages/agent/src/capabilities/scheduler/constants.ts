/**
 * Scheduler constants & identifiers.
 */

/** Task kind that runs the AI chat() path directly with the task prompt. */
export const PROMPT_TASK_KIND = "prompt";

/**
 * Conversation id used to run a scheduled prompt task in an isolated context,
 * keeping it separate from the user's real conversation history.
 */
export function schedulerConversationId(seq: number | bigint): string {
  return `scheduler:${seq}`;
}
