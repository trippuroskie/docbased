// Fumadocs search index. Mounted at /api/docs-search to avoid clashing
// with the docbased /api/search route. The (docs) layout points
// RootProvider at this URL via the searchOptions prop.

import { createFromSource } from "fumadocs-core/search/server";
import { source } from "@/lib/source";

export const { GET } = createFromSource(source);
