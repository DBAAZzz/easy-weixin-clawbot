/**
 * Best-effort extraction of a JSON object from free-form LLM output.
 *
 * LLMs often wrap JSON in markdown fences or surround it with prose despite
 * being asked for raw JSON. This returns the most likely JSON substring without
 * parsing it — callers decide how to parse and validate.
 *
 * Strategy:
 *   1. Prefer the contents of a ```json … ``` (or bare ``` … ```) fenced block.
 *   2. Otherwise take the span from the first `{` to the last `}`.
 *
 * Returns null when no plausible object is found.
 */
export function extractJsonBlock(text: string): string | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(text);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return null;
  }
  return text.slice(start, end + 1);
}
