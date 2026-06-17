import { cn } from "../utils/cn.js";
import type { PaginationClassNameOptions } from "./type.js";

export function paginationClassName(options?: PaginationClassNameOptions) {
  return cn("cb-pagination", options?.className);
}
