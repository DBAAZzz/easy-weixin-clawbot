/**
 * 依赖版本约束的宽松解析与比较，服务于「已安装版本是否满足 installSpec」判定。
 *
 * 覆盖范围有意收敛在常见写法：PEP 440 的 ==/!=/>=/<=/>/</~= 与 npm 的 ^/~。
 * 解析不出来的约束一律按「无约束」处理——宁可漏报 outdated，也不要把能用的环境误判成过期。
 */

export type VersionOperator = "==" | "!=" | ">=" | "<=" | ">" | "<" | "~=" | "^" | "~";

export interface VersionConstraint {
  operator: VersionOperator;
  version: string;
}

const CLAUSE_PATTERN = /^(===|==|!=|>=|<=|~=|\^|~|>|<|=)?\s*v?(\d[\w.*]*)$/;

/**
 * 从 installSpec 中剥离包名，解析出版本约束子句。
 *
 * 同时兼容两种形态：`numpy>=1.20,<2.0`（PEP 440）与 `lodash@^4.17.0`（npm）。
 * 可传多个候选包名（原始名 + 规范化名），逐个尝试剥离——上游拿到的名字未必与
 * installSpec 里的写法一致（`scikit_learn` / `scikit-learn`，或整串含版本区间）。
 * 返回空数组表示「无版本要求」，调用方应把任意已安装版本视为满足。
 */
export function parseVersionConstraints(
  installSpec: string | undefined,
  ...names: string[]
): VersionConstraint[] {
  if (!installSpec) return [];

  const spec = installSpec.trim();
  // 逐个候选名尝试，取第一个能解析出约束的结果；空字符串代表「不剥离包名」
  for (const name of [...names.filter(Boolean), ""]) {
    const constraints = parseAfterName(spec, name);
    if (constraints.length > 0) {
      return constraints;
    }
  }
  return [];
}

function parseAfterName(spec: string, name: string): VersionConstraint[] {
  let rest = name && spec.toLowerCase().startsWith(name.toLowerCase()) ? spec.slice(name.length) : spec;
  // python extras：requests[security]>=2.0
  rest = rest.replace(/^\[[^\]]*\]/, "").trim();
  // npm 的 name@range 形态，剥离包名后残留的 @
  if (rest.startsWith("@")) {
    rest = rest.slice(1).trim();
  }
  if (!rest || rest === "*" || rest === "latest") return [];

  const constraints: VersionConstraint[] = [];
  for (const clause of rest.split(",")) {
    const parsed = parseClause(clause.trim());
    if (parsed) {
      constraints.push(parsed);
    }
  }
  return constraints;
}

function parseClause(clause: string): VersionConstraint | null {
  const match = CLAUSE_PATTERN.exec(clause);
  if (!match) return null;

  const rawOperator = match[1] ?? "==";
  const operator: VersionOperator =
    rawOperator === "===" || rawOperator === "=" ? "==" : (rawOperator as VersionOperator);
  return { operator, version: match[2] };
}

/** 所有约束都满足才算满足；空约束恒为 true。 */
export function satisfiesVersion(installed: string, constraints: VersionConstraint[]): boolean {
  return constraints.every((constraint) => satisfiesConstraint(installed, constraint));
}

function satisfiesConstraint(installed: string, constraint: VersionConstraint): boolean {
  const { operator, version } = constraint;

  if (version.includes("*")) {
    // ==1.4.* 之类的前缀匹配，只有等值语义下有意义
    const matched = matchesWildcard(installed, version);
    if (operator === "==") return matched;
    if (operator === "!=") return !matched;
    return true;
  }

  switch (operator) {
    case "==":
      return compareVersions(installed, version) === 0;
    case "!=":
      return compareVersions(installed, version) !== 0;
    case ">=":
      return compareVersions(installed, version) >= 0;
    case ">":
      return compareVersions(installed, version) > 0;
    case "<=":
      return compareVersions(installed, version) <= 0;
    case "<":
      return compareVersions(installed, version) < 0;
    case "~=":
    case "^":
    case "~":
      return (
        compareVersions(installed, version) >= 0 &&
        compareVersions(installed, upperBound(operator, version)) < 0
      );
  }
}

/**
 * 计算「兼容版本」类操作符的开区间上界。
 *
 * - `~=1.4.2` / `~1.4.2` → 1.5.0（锁定次版本）
 * - `~=1.4` / `~1.4`     → 2.0（锁定主版本）
 * - `^4.17.0`            → 5.0.0；npm 对 0.x 有特殊规则：^0.2.3 → 0.3.0，^0.0.3 → 0.0.4
 */
function upperBound(operator: "~=" | "^" | "~", version: string): string {
  const segments = toSegments(version);
  if (segments.length === 0) return version;

  if (operator === "^") {
    const firstNonZero = segments.findIndex((segment) => segment > 0);
    // ^0.0.0 这类全零版本按最后一段递增处理
    const index = firstNonZero === -1 ? segments.length - 1 : firstNonZero;
    return bumpAt(segments, index);
  }

  // ~= 与 ~：丢弃最后一段，递增其前一段；只有一段时直接递增该段
  const index = Math.max(0, segments.length - 2);
  return bumpAt(segments, index);
}

function bumpAt(segments: number[], index: number): string {
  const bumped = segments.slice(0, index + 1);
  bumped[index] += 1;
  return bumped.join(".");
}

function matchesWildcard(installed: string, pattern: string): boolean {
  const prefix = pattern.slice(0, pattern.indexOf("*"));
  return normalizeVersion(installed).startsWith(prefix);
}

/** 逐段数值比较；缺失的段按 0 补齐，`1.2` 与 `1.2.0` 等价。 */
export function compareVersions(left: string, right: string): number {
  const leftSegments = toSegments(left);
  const rightSegments = toSegments(right);
  const length = Math.max(leftSegments.length, rightSegments.length);

  for (let index = 0; index < length; index += 1) {
    const diff = (leftSegments[index] ?? 0) - (rightSegments[index] ?? 0);
    if (diff !== 0) {
      return diff > 0 ? 1 : -1;
    }
  }
  return 0;
}

/** 预发布/构建后缀（1.0.0-rc.1、1.0.0+build）不参与排序，直接截断。 */
function normalizeVersion(version: string): string {
  return version.trim().replace(/^v/, "").split(/[-+]/)[0];
}

function toSegments(version: string): number[] {
  const segments: number[] = [];
  for (const part of normalizeVersion(version).split(".")) {
    const match = /^(\d+)$/.exec(part);
    if (!match) break;
    segments.push(Number.parseInt(match[1], 10));
  }
  return segments;
}
