import { createHash } from "node:crypto";
import { assertJsonValue, type JsonValue } from "./json-value.js";

function serializeString(value: string): string {
  return JSON.stringify(value);
}

function serializeValue(value: JsonValue): string {
  if (value === null) return "null";

  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number": {
      const serialized = JSON.stringify(value);
      if (serialized === undefined) {
        throw new TypeError("Canonical JSON requires a finite number");
      }
      return serialized;
    }
    case "string":
      return serializeString(value);
    case "object": {
      if (Array.isArray(value)) {
        return `[${value.map(serializeValue).join(",")}]`;
      }

      const entries = Object.keys(value)
        .sort()
        .map((key) => `${serializeString(key)}:${serializeValue(value[key]!)}`);
      return `{${entries.join(",")}}`;
    }
  }
}

/** Returns the RFC 8785 canonical representation or throws when input is not valid JSON/I-JSON. */
export function canonicalizeJson(input: unknown): string {
  assertJsonValue(input);
  return serializeValue(input);
}

/** Hashes the UTF-8 RFC 8785 canonical representation with SHA-256. */
export function sha256CanonicalJson(input: unknown): string {
  return createHash("sha256").update(canonicalizeJson(input), "utf8").digest("hex");
}
