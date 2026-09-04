export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

function assertValidUnicode(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (index + 1 >= value.length || next < 0xdc00 || next > 0xdfff) {
        throw new TypeError("JSON cannot encode a lone high surrogate");
      }
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      throw new TypeError("JSON cannot encode a lone low surrogate");
    }
  }
}

function assertArrayShape(value: unknown[]): void {
  if (Object.getPrototypeOf(value) !== Array.prototype) {
    throw new TypeError("JSON requires a plain array");
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new TypeError("JSON arrays cannot have symbol properties");
  }

  const names = Object.getOwnPropertyNames(value);
  if (names.length !== value.length + 1 || !names.includes("length")) {
    throw new TypeError("JSON arrays cannot have extra properties");
  }
  for (let index = 0; index < value.length; index += 1) {
    if (names[index] !== String(index)) {
      throw new TypeError("JSON arrays must be dense and cannot have extra properties");
    }
  }
}

/** Throws unless input is finite, plain, acyclic I-JSON with no lossy properties. */
export function assertJsonValue(
  input: unknown,
  ancestors = new Set<object>(),
): asserts input is JsonValue {
  if (input === null || typeof input === "boolean") return;
  if (typeof input === "string") {
    assertValidUnicode(input);
    return;
  }
  if (typeof input === "number") {
    if (!Number.isFinite(input)) throw new TypeError("JSON requires a finite number");
    return;
  }
  if (typeof input !== "object") throw new TypeError(`JSON cannot encode ${typeof input}`);

  if (ancestors.has(input)) throw new TypeError("JSON cannot encode a cycle");
  ancestors.add(input);
  try {
    if (Array.isArray(input)) {
      assertArrayShape(input);
      for (let index = 0; index < input.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
        if (!descriptor || !("value" in descriptor)) {
          throw new TypeError("JSON arrays cannot have accessor elements");
        }
        assertJsonValue(descriptor.value, ancestors);
      }
      return;
    }

    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("JSON requires a plain object");
    }
    if (Object.getOwnPropertySymbols(input).length > 0) {
      throw new TypeError("JSON objects cannot have symbol properties");
    }
    if (Object.getOwnPropertyNames(input).length !== Object.keys(input).length) {
      throw new TypeError("JSON objects cannot have hidden properties");
    }

    for (const [key, value] of Object.entries(input)) {
      assertValidUnicode(key);
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (!descriptor || !("value" in descriptor)) {
        throw new TypeError("JSON objects cannot have accessor properties");
      }
      assertJsonValue(value, ancestors);
    }
  } finally {
    ancestors.delete(input);
  }
}

export function isJsonValue(input: unknown): input is JsonValue {
  try {
    assertJsonValue(input);
    return true;
  } catch {
    return false;
  }
}

export function cloneJsonValue(input: JsonValue): JsonValue {
  return structuredClone(input);
}
