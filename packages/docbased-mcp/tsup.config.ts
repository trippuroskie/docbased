import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  platform: "node",
  splitting: false,
  sourcemap: false,
  clean: true,
  minify: false,
  shims: false,
  banner: { js: "#!/usr/bin/env node" },
  outExtension: () => ({ js: ".mjs" }),
  // Default tsup behavior is already correct: externalize node_modules deps,
  // bundle relative imports. The core/* helpers live at ../../src/lib/core/
  // (outside this package's tree) and tsup picks them up via the @core/*
  // path mapping in tsconfig.json, then bundles them into dist/index.mjs.
});
