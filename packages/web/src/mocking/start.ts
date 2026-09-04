import { setupWorker } from "msw/browser";
import { demoHandlers } from "./handlers.js";

/**
 * Boots the MSW service worker so every `/api/*` call is answered by the
 * in-memory demo store. Only invoked when the app is built with
 * `VITE_API_MOCK=1`; normal builds never load this module.
 */
export async function startApiMock(): Promise<void> {
  const worker = setupWorker(...demoHandlers);
  await worker.start({
    onUnhandledRequest: "bypass",
    quiet: true,
  });
}
