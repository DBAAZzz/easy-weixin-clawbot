// 零依赖静态服务器：ES Modules 和 Shader 资源必须走 HTTP，直接开 file://
// 会被同源策略拦掉，所以本地预览需要它。
//
//   node serve.mjs [--port 8731] [--dir .]
//
//   npm run dev     开发时伺服源码目录（改完刷新即可，没有构建步骤）
//   npm run serve   构建后预览 dist/

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";

const args = process.argv.slice(2);
const readFlag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};

const port = Number(readFlag("port", "8731"));
const root = resolve(readFlag("dir", "."));

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
};

const send = (res, status, body) => {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  res.end(body);
};

const server = createServer(async (req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  } catch {
    send(res, 400, "400 Bad Request");
    return;
  }

  // normalize 之后再拼接，挡掉 ../ 逃出 root 的路径。
  const filePath = join(root, normalize(pathname));
  if (filePath !== root && !filePath.startsWith(root + sep)) {
    send(res, 403, "403 Forbidden");
    return;
  }

  try {
    let target = filePath;
    let info = await stat(target);
    if (info.isDirectory()) {
      target = join(target, "index.html");
      info = await stat(target);
    }

    res.writeHead(200, {
      "content-type": MIME[extname(target).toLowerCase()] ?? "application/octet-stream",
      "content-length": info.size,
      // 本地预览要的是改完就能看到，别让浏览器缓存住旧文件。
      "cache-control": "no-cache",
    });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    createReadStream(target).pipe(res);
  } catch {
    send(res, 404, "404 Not Found");
  }
});

server.listen(port, () => {
  console.log(`${root} → http://127.0.0.1:${port}/`);
});
