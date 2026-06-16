import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  dts: true,
  clean: true,
  deps: {
    neverBundle: ["react", "react-dom"],
  },
});
