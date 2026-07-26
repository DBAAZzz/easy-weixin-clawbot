import { TimeoutError } from "../errors.js";

/**
 * Race a promise against a timeout. If `promise` does not settle within `ms`,
 * the returned promise rejects with {@link TimeoutError}.
 *
 * Note: the underlying work is not cancelled — it keeps running in the
 * background. Callers that need cancellation must wire their own AbortSignal.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError()), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer)) as Promise<T>;
}
