// 构建脚本：把 6 个 ES 模块打成 1 个、压缩 CSS，输出到 dist/。
//
// 源码目录保持零构建——开发时直接开 index.html 就能跑，改完刷新即可。
// 这个脚本只在部署前跑一次。
//
//   npm install     装 esbuild（唯一的依赖）
//   npm run build   产出 dist/
//   npm run serve   本地预览 dist/

import { build } from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, "dist");

// 跟着 index.html 走的静态文件，原样拷过去。少一个就让构建失败——这些文件
// 是 index.html 和 robots.txt 里用绝对 URL 引的，缺了不会报错，只会在线上
// 变成 404（社交卡片抓不到图、sitemap 失效），本地很难发现。
const staticFiles = ["og-image.jpg", "robots.txt", "sitemap.xml"];

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

// main.js 和 site.js 之间没有 import 关系（靠 CustomEvent 通信），但两者
// 在同一个页面上都要加载，合成一个文件可以省掉一次请求。更重要的是去掉
// ES 模块的依赖瀑布：浏览器要先下完 main.js 才知道还需要 gl/math/shaders，
// 高延迟网络下这是实打实的一个额外往返。
const entry = join(dist, "_entry.js");
await writeFile(entry, 'import "../src/main.js";\nimport "../src/site.js";\n');

const js = await build({
  entryPoints: [entry],
  bundle: true,
  minify: true,
  format: "esm",
  // 项目用了 ?. 、逻辑赋值、类字段之类的现代语法，而 WebGL2 本身就要求
  // 相当新的浏览器，没必要为老引擎降级。
  target: "es2020",
  outfile: join(dist, "app.js"),
  metafile: true,
  logLevel: "warning",
});
await rm(entry);

// CSS 里有 @property、color-mix()、范围型媒体查询这些较新的语法。
// target 定高一点，避免 esbuild 试图降级成老写法反而把它们改坏。
await build({
  entryPoints: [join(root, "styles.css")],
  minify: true,
  target: ["chrome111", "safari16.4", "firefox113"],
  outfile: join(dist, "styles.css"),
  logLevel: "warning",
});

// HTML 只改引用，不做压缩。终端那四行命令的 span 是 white-space: pre，
// HTML 压缩器折叠空白会直接把它们显示坏。3 KB 的 gzip 也不值得冒这个险。
let html = await readFile(join(root, "index.html"), "utf8");
html = html.replace(
  /\s*<script type="module" src="\.\/src\/main\.js"><\/script>\s*<script type="module" src="\.\/src\/site\.js"><\/script>/,
  '\n  <script type="module" src="./app.js"></script>',
);

if (html.includes("./src/main.js")) {
  throw new Error("index.html 里的 script 标签没被替换掉，检查 build.mjs 的正则。");
}

await writeFile(join(dist, "index.html"), html);

for (const file of staticFiles) {
  await cp(join(root, file), join(dist, file)).catch((err) => {
    throw new Error(`静态文件拷贝失败：${file}`, { cause: err });
  });
}

const bytes = Object.entries(js.metafile.outputs)[0][1].bytes;
console.log(`dist/app.js      ${bytes} 字节`);
console.log("构建完成 → dist/");
