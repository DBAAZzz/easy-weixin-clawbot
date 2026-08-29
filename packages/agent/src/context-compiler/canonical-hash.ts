import { sha256CanonicalJson } from "../shared/fact-ledger/canonical-json.js";

export function hashCanonicalValue(value: unknown): string {
  return sha256CanonicalJson(value);
}
