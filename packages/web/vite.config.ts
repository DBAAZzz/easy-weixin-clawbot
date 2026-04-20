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
