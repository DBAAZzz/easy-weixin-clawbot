/**
 * PII 脱敏模块
 *
 * 对 prompt / completion 原文进行脱敏处理后再写入 span payload。
 * 内置常见 PII 模式（手机号、身份证号等），支持自定义规则扩展。
 *
 * 注意：正则带 /g 标志时有 lastIndex 状态，
 * 每次调用前需重置，这里通过 new RegExp 复制避免状态污染。
 */

export interface SanitizeRule {
  /** 匹配模式 */
  pattern: RegExp;
  /** 替换文本，默认 "[REDACTED]" */
  replacement?: string;
}

/** 内置脱敏规则（中国大陆常见 PII）——长模式优先，避免短模式先破坏长串 */
export const builtinRules: SanitizeRule[] = [
  // 身份证号：18 位（必须在手机号之前，否则手机号正则会截断身份证）
  { pattern: /(?<!\d)\d{17}[\dXx](?!\d)/g },
  // 手机号：1xx-xxxx-xxxx
  { pattern: /(?<!\d)1[3-9]\d{9}(?!\d)/g },
  // 邮箱
  { pattern: /[\w.-]+@[\w.-]+\.\w+/g },
];

const DEFAULT_REPLACEMENT = "[REDACTED]";

/**
 * 对文本执行脱敏
 *
 * @param text 原始文本
 * @param rules 脱敏规则，默认使用 builtinRules
 * @returns 脱敏后的文本
 */
export function sanitize(
  text: string,
  rules: SanitizeRule[] = builtinRules,
): string {
  let result = text;
  for (const rule of rules) {
    // 复制正则避免 /g 的 lastIndex 状态污染
    const pattern = new RegExp(rule.pattern.source, rule.pattern.flags);
    result = result.replace(pattern, rule.replacement ?? DEFAULT_REPLACEMENT);
  }
  return result;
}
