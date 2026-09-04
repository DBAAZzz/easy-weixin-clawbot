import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envDir = path.resolve(__dirname, "../..");

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, envDir, "");
  const apiPort = env.API_PORT?.trim() || "8028";

  return {
    envDir,
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        // 必须指向 dist 的完整捆绑产物（bundle-css.mjs 会 glob 收集全部组件样式）；
        // src/style.css 只含 tokens + shared，会让 web 丢失所有组件样式。
        "@clawbot/ui/style.css": path.resolve(__dirname, "../ui/dist/style.css"),
        "@clawbot/ui/sonner.css": path.resolve(__dirname, "../ui/dist/sonner.css"),
        "@clawbot/ui": path.resolve(__dirname, "../ui/src/index.ts"),
        "@": path.resolve(__dirname, "src"),
      },
    },
    build: {
      cssMinify: "esbuild",
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (
              id.includes("node_modules/react-dom/") ||
              id.includes("node_modules/react/") ||
              id.includes("node_modules/react-router-dom/") ||
              id.includes("node_modules/react-router/")
            ) {
              return "vendor-react";
            }
            if (id.includes("node_modules/@tanstack/react-query")) {
              return "vendor-query";
            }
            if (
              id.includes("node_modules/react-force-graph-2d") ||
              id.includes("node_modules/force-graph") ||
              id.includes("node_modules/d3-")
            ) {
              return "vendor-force-graph";
            }
          },
        },
      },
    },
    server: {
      port: 5173,
      proxy: {
        "/api": `http://localhost:${apiPort}`,
      },
    },
    optimizeDeps: {
      include: ["react", "react-dom"],
      // Vite 8 新增：强制重新预构建
      force: false,
    },
  };
});
