export interface NormalizeResult {
  normalized: Record<string, unknown>;
  warnings: string[];
}

export interface NormalizeOptions {
  defaultType?: "skill" | "tool";
}

const FIELD_MAPPINGS: Record<string, string> = {
  description: "summary",
  desc: "summary",
};

export function normalizeFrontmatter(
  raw: Record<string, unknown>,
  options: NormalizeOptions = {},
): NormalizeResult {
  const warnings: string[] = [];
  const result = { ...raw };
  const defaultType = options.defaultType ?? "skill";

  // Field name mapping
  for (const [from, to] of Object.entries(FIELD_MAPPINGS)) {
    if (result[from] && !result[to]) {
      result[to] = result[from];
      delete result[from];
      warnings.push(`字段 "${from}" 已映射为 "${to}"`);
    }
  }

  // Missing field defaults
  if (!result.version) {
    result.version = "0.0.0";
    warnings.push('缺失 "version"，已设为 "0.0.0"');
  }

  if (!result.type) {
    result.type = defaultType;
    warnings.push(`缺失 "type"，已推断为 "${result.type}"`);
  }

  if (!result.activation && result.type === "skill") {
    result.activation = "on-demand";
    warnings.push('缺失 "activation"，已设为 "on-demand"');
  }

  return { normalized: result, warnings };
}
