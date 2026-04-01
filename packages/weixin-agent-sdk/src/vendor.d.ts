declare module "silk-wasm" {
  export function decode(
    input: Buffer,
    sampleRate: number,
  ): Promise<{ data: Uint8Array; duration: number }>;
}

declare module "qrcode-terminal" {
  const qrcodeTerminal: {
    generate(
      text: string,
      options?: { small?: boolean },
      callback?: (qr: string) => void,
    ): void;
  };
  export default qrcodeTerminal;
}
