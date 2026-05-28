// Wraps the entire (docs) route group with Fumadocs's RootProvider so the
// theme toggle, search, and TOC components work. The Fumadocs stylesheet
// is imported here; Next hoists it into the global bundle but its tokens
// are namespaced so the rest of the app keeps its existing styling.
//
// Search is mounted at /api/docs-search to avoid colliding with the
// knowledge-hub /api/search route.

import { RootProvider } from "fumadocs-ui/provider/next";
import type { ReactNode } from "react";
import "fumadocs-ui/style.css";

export default function DocsRouteGroupLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <RootProvider
      search={{
        options: {
          api: "/api/docs-search",
        },
      }}
    >
      {children}
    </RootProvider>
  );
}
