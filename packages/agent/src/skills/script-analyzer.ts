import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import type { ScriptDescriptor, SkillRuntime } from "./types.js";

const PYTHON_EXTENSIONS = new Set([".py"]);
const NODE_EXTENSIONS = new Set([".js", ".mjs", ".cjs"]);

// 这里维护一份“常见 Python 标准库”白名单。
// 目的是避免把 warnings/json/os 这类内建模块误判成第三方依赖，
// 否则后续 provision 时会错误地执行 `pip install warnings`。
const PYTHON_STD_LIBS = new Set([
  "__future__",
  "abc",
  "argparse",
  "asyncio",
  "base64",
  "bisect",
  "builtins",
  "collections",
  "copy",
  "contextlib",
  "csv",
  "dataclasses",
  "datetime",
  "decimal",
  "enum",
  "fractions",
  "functools",
  "glob",
  "hashlib",
  "heapq",
  "http",
  "importlib",
  "inspect",
  "io",
  "itertools",
  "json",
  "linecache",
  "logging",
  "math",
  "os",
  "pathlib",
  "pprint",
  "random",
  "re",
  "shlex",
  "signal",
  "sqlite3",
  "statistics",
  "string",
  "subprocess",
  "shutil",
  "sys",
  "tempfile",
  "textwrap",
  "threading",
  "time",
  "traceback",
  "types",
  "typing",
  "unittest",
  "urllib",
  "uuid",
  "warnings",
]);

// 仅通过脚本扩展名识别当前支持的运行时。
// 第一版只支持 Python 和 Node 两类脚本。
function detectRuntime(filePath: string): SkillRuntime | null {
  const extension = extname(filePath).toLowerCase();
  if (PYTHON_EXTENSIONS.has(extension)) {
    return "python";
  }
  if (NODE_EXTENSIONS.has(extension)) {
    return "node";
  }
  return null;
}

// 对 import 结果做去重并稳定排序，保证探测结果可预测、便于测试。
function dedupeSorted(items: Iterable<string>): string[] {
  return [...new Set(items)].sort((left, right) => left.localeCompare(right));
}

// 静态解析 Python import：
// - 支持 `import foo` / `import foo as bar`
// - 支持 `from foo import x`
// - 只取顶级模块名
// - 过滤标准库，保留潜在第三方依赖
function parsePythonImports(content: string): string[] {
  const imports = new Set<string>();
  const lines = content.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const importMatch = trimmed.match(/^import\s+(.+)$/);
    if (importMatch) {
      for (const part of importMatch[1].split(",")) {
        const moduleName = part.trim().split(/\s+as\s+/)[0]?.split(".")[0];
        if (moduleName && !PYTHON_STD_LIBS.has(moduleName)) {
          imports.add(moduleName);
        }
      }
      continue;
    }

    const fromMatch = trimmed.match(/^from\s+([A-Za-z_][\w.]*)\s+import\s+/);
    if (fromMatch) {
      const moduleName = fromMatch[1].split(".")[0];
      if (moduleName && !PYTHON_STD_LIBS.has(moduleName)) {
        imports.add(moduleName);
      }
    }
  }

  return dedupeSorted(imports);
}

// 静态解析 Node import：
// - 支持 ESM `from/import`
// - 支持 CommonJS `require`
// - 过滤相对路径和 `node:` 内建模块
// - 对 scoped package 保留 `@scope/name`
function parseNodeImports(content: string): string[] {
  const imports = new Set<string>();
  const importPatterns = [
    /from\s+["']([^"']+)["']/g,
    /import\s+["']([^"']+)["']/g,
    /require\(\s*["']([^"']+)["']\s*\)/g,
  ];

  for (const pattern of importPatterns) {
    for (const match of content.matchAll(pattern)) {
      const specifier = match[1];
      if (!specifier || specifier.startsWith(".") || specifier.startsWith("node:")) continue;
      const packageName = specifier.startsWith("@")
        ? specifier.split("/").slice(0, 2).join("/")
        : specifier.split("/")[0];
      if (packageName) {
        imports.add(packageName);
      }
    }
  }

  return dedupeSorted(imports);
}

// 读取脚本文件并产出结构化描述，供 runtime-detector 做后续判断。
// 这里除了 import 外，还会顺手探测它是否像一个 CLI 入口：
// - Python: 是否包含 `if __name__ == "__main__"`
// - Node: 是否使用 `process.argv` / commander / yargs
export async function analyzeScript(rootDir: string, relativePath: string): Promise<ScriptDescriptor | null> {
  const runtime = detectRuntime(relativePath);
  if (!runtime) {
    return null;
  }

  const filePath = join(rootDir, relativePath);
  const content = await readFile(filePath, "utf8");

  return {
    path: relativePath,
    runtime,
    imports: runtime === "python" ? parsePythonImports(content) : parseNodeImports(content),
    hasCliMain:
      runtime === "python"
        ? content.includes('__name__ == "__main__"') || content.includes("__name__ == '__main__'")
        : content.includes("process.argv") || content.includes("commander") || content.includes("yargs"),
  };
}
