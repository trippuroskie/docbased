// Fumadocs MDX configuration. Scans `content/docs/` for .mdx pages and
// auto-generates type-safe collections at .source/ during dev / build.

import { defineConfig, defineDocs } from "fumadocs-mdx/config";

export const docs = defineDocs({
  dir: "content/docs",
});

export default defineConfig();
