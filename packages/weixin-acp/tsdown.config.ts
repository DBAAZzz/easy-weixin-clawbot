import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["./main.ts", "./index.ts"],
  dts: true,
});
