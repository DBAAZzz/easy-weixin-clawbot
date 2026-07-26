/**
 * Tape branch constants.
 *
 * A "branch" namespaces tape memory. Every account has one shared global branch
 * plus per-conversation session branches. The global branch name is a sentinel
 * that must stay in sync everywhere it is read or written.
 */

/** Sentinel branch name for account-wide (cross-conversation) memory. */
export const GLOBAL_BRANCH = "__global__";

/** True when `branch` is the account-wide global branch. */
export function isGlobalBranch(branch: string): boolean {
  return branch === GLOBAL_BRANCH;
}
