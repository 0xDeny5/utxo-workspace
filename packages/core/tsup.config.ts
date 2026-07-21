import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/strategies.ts", "src/weights.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  splitting: false,
  target: "es2020",
});
