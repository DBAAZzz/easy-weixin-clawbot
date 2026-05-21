import type { ModelMeta } from "./types.js";

export function modelSupportsVision(meta: ModelMeta): boolean {
  return meta.supportsImageInput === true;
}
