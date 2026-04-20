import type { TTSProvider } from "./types.js";
import { createEdgeTTSProvider } from "./provider-edge.js";
import { createModuleLogger } from "../../logger.js";

export type { TTSProvider, TTSOptions, TTSResult, TTSVoice } from "./types.js";

const TTS_PROVIDER = process.env.TTS_PROVIDER ?? "edge-tts";

const providers: Record<string, () => TTSProvider> = {
  "edge-tts": createEdgeTTSProvider,
};

let instance: TTSProvider | undefined;

const ttsLogger = createModuleLogger("tts");

/** Get the singleton TTS provider (lazily created). */
export function getTTSProvider(): TTSProvider {
  if (!instance) {
    const factory = providers[TTS_PROVIDER];
    if (!factory) {
      throw new Error(
        `[tts] Unknown provider "${TTS_PROVIDER}". Available: ${Object.keys(providers).join(", ")}`,
      );
    }
    instance = factory();
    ttsLogger.info({ provider: TTS_PROVIDER }, "TTS 提供器已初始化");
  }
  return instance;
}

/**
 * Register a custom TTS provider factory.
 * Call before first getTTSProvider() to add new providers.
 */
export function registerTTSProvider(name: string, factory: () => TTSProvider) {
  providers[name] = factory;
}
