// Sidebar + topbar shell for /docs/*. The actual page tree comes from
// the MDX collection in content/docs/, surfaced via `src/lib/source.ts`.

import { DocsLayout } from "fumadocs-ui/layouts/docs";
import type { ReactNode } from "react";
import { baseOptions } from "@/app/layout.config";
import { source } from "@/lib/source";

export default function DocsSectionLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <DocsLayout tree={source.pageTree} {...baseOptions}>
      {children}
    </DocsLayout>
  );
}
