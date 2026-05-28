// Shared layout config consumed by the Fumadocs DocsLayout.

import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

export const baseOptions: BaseLayoutProps = {
  nav: {
    title: "docbased docs",
  },
  links: [
    {
      text: "Hub",
      url: "/",
      active: "nested-url",
    },
  ],
};
