type StdoutWrite = typeof process.stdout.write;
const ANSI_ESCAPE_RE = /\u001B\[[0-9;]*m/g;
const QR_CHAR_RE = /[█▄▀▐▌░▒▓]/;

export function isTerminalQrText(text: string): boolean {
  const normalized = text.replace(ANSI_ESCAPE_RE, "");
  const lines = normalized.split(/\r?\n/).filter((line) => line.trim().length > 0);

  return lines.length >= 6 && lines.some((line) => QR_CHAR_RE.test(line));
}

/**
 * Capture stdout writes and forward a complete QR block to onOutput.
 * Non-QR stdout content is ignored.
 */
export function captureStdout(onOutput: (qrText: string) => void): () => void {
  const original = process.stdout.write.bind(process.stdout) as StdoutWrite;
  const invokeOriginal = (...args: unknown[]) =>
    (original as (...innerArgs: unknown[]) => boolean)(...args);
  let buffer = "";
  let capturing = false;
  let flushed = false;

  function flushBuffer() {
    if (buffer.length === 0) {
      capturing = false;
      return;
    }

    const qrText = buffer;
    buffer = "";
    capturing = false;

    if (!flushed && isTerminalQrText(qrText)) {
      flushed = true;
      onOutput(qrText);
    }
  }

  process.stdout.write = ((chunk: Parameters<StdoutWrite>[0], ...args: unknown[]) => {
    const text = typeof chunk === "string" ? chunk : chunk.toString();

    if (text.length > 0) {
      const normalized = text.replace(ANSI_ESCAPE_RE, "");

      if (QR_CHAR_RE.test(normalized)) {
        capturing = true;
        buffer += normalized;
      } else if (capturing) {
        if (normalized.trim() === "") {
          buffer += normalized;
        }

        flushBuffer();
      }
    }

    return invokeOriginal(chunk, ...args);
  }) as StdoutWrite;

  return () => {
    if (capturing) {
      flushBuffer();
    }
    process.stdout.write = original;
  };
}
