import { EdgeTTS, Constants } from "@andresaya/edge-tts";
import type { TTSOptions, TTSProvider, TTSResult, TTSVoice } from "./types.js";

const DEFAULT_VOICE = "zh-CN-XiaoxiaoNeural";
const DEFAULT_FORMAT = Constants.OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3;

export function createEdgeTTSProvider(): TTSProvider {
  return {
    async synthesize(text: string, options?: TTSOptions): Promise<TTSResult> {
      const tts = new EdgeTTS();
      const voice = options?.voice ?? DEFAULT_VOICE;

      await tts.synthesize(text, voice, {
        rate: options?.rate,
        pitch: options?.pitch,
        volume: options?.volume,
        outputFormat: options?.outputFormat ?? DEFAULT_FORMAT,
      });

      const info = tts.getAudioInfo();

      return {
        audio: tts.toBuffer(),
        format: info.format ?? "mp3",
        duration: info.estimatedDuration,
      };
    },

    async getVoices(language?: string): Promise<TTSVoice[]> {
      const tts = new EdgeTTS();
      const voices = language
        ? await tts.getVoicesByLanguage(language)
        : await tts.getVoices();

      return voices.map((v) => ({
        id: v.ShortName,
        name: v.FriendlyName,
        language: v.Locale,
        gender: v.Gender as "Male" | "Female",
      }));
    },
  };
}
