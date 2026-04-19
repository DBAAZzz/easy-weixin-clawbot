import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  build: {
    cssMinify: "esbuild",
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8028",
    },
  },
  optimizeDeps: {
    include: ["react", "react-dom"],
    // Vite 8 新增：强制重新预构建
    force: false,
  },
});
