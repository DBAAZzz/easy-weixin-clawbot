/**
 * Prompt system — asset loading, profile declarations, and assembly.
 */

// Types
export type { PromptLane, PromptProfile, PromptAssets, PromptAssetSpec } from "./types.js";

// Profile declarations
export { PROMPT_PROFILES, PROMPT_TEMPLATES, PROMPT_ASSET_SPECS } from "./profiles.js";

// Loader
export {
  loadPromptAssets,
  resolveBundledPromptsDir,
  type LoadPromptAssetsOptions,
} from "./loader.js";

// Assembler
export {
  renderTemplate,
  listTemplateVars,
  validateTemplateVars,
  assembleSystemPrompt,
  assembleUserContext,
  type UserContextOptions,
} from "./assembler.js";

// Port (DI)
export { setPromptAssets, getPromptAssets } from "./port.js";
