import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const importPattern = /@import\s+["'](\.[^"']*)["'];/g;

async function bundleCss(relativeInput, seen = new Set()) {
  const input = resolve(packageRoot, relativeInput);

  if (seen.has(input)) {
    return "";
  }

  seen.add(input);

  const source = await readFile(input, "utf8");
  const inputDir = dirname(input);
  let output = "";
  let cursor = 0;

  for (const match of source.matchAll(importPattern)) {
    output += source.slice(cursor, match.index);
    const importedPath = resolve(inputDir, match[1]);
    const importedRelative = importedPath.slice(packageRoot.length + 1);
    output += await bundleCss(importedRelative, seen);
    cursor = match.index + match[0].length;
  }

  output += source.slice(cursor);

  return output;
}

async function writeBundledCss(input, output) {
  const bundled = await bundleCss(input);
  const outputPath = resolve(packageRoot, output);

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${bundled.trim()}\n`, "utf8");
}

await writeBundledCss("src/style.css", "dist/style.css");
await writeBundledCss("src/tokens.css", "dist/tokens.css");

const indexPath = resolve(packageRoot, "dist/index.mjs");
const indexSource = await readFile(indexPath, "utf8");

if (!indexSource.startsWith('import "./style.css";')) {
  await writeFile(indexPath, `import "./style.css";\n${indexSource}`, "utf8");
}
