/**
 * Prompt assets DI port — follows the same pattern as other ports.
 */

import type { PromptAssets } from "./types.js";

let _assets: PromptAssets | null = null;

export function setPromptAssets(assets: PromptAssets): void {
  _assets = assets;
}

export function getPromptAssets(): PromptAssets {
  if (!_assets) throw new Error("PromptAssets not initialized — call setPromptAssets() at startup");
  return _assets;
}
