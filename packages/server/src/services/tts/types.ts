/** Provider-agnostic TTS interface. */
export interface TTSProvider {
  /** Synthesize text to audio. */
  synthesize(text: string, options?: TTSOptions): Promise<TTSResult>;

  /** List available voices, optionally filtered by language. */
  getVoices(language?: string): Promise<TTSVoice[]>;
}

export interface TTSOptions {
  /** Voice identifier, e.g. 'zh-CN-XiaoxiaoNeural' */
  voice?: string;
  /** Speech rate, e.g. '+10%' or '-20%' */
  rate?: string;
  /** Pitch adjustment, e.g. '+5Hz' */
  pitch?: string;
  /** Volume adjustment, e.g. '90%' */
  volume?: string;
  /** Output format, provider-specific string */
  outputFormat?: string;
}

export interface TTSResult {
  /** Raw audio data */
  audio: Buffer;
  /** File extension without dot, e.g. 'mp3' */
  format: string;
  /** Estimated duration in seconds, if available */
  duration?: number;
}

export interface TTSVoice {
  /** Full voice identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Locale, e.g. 'zh-CN' */
  language: string;
  gender: "Male" | "Female";
}
