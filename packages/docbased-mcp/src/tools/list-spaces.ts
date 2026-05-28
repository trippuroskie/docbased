// list_spaces — enumerate spaces the current caller can read.

import { z } from "zod";
import type { FastMCP } from "fastmcp";
import { listSpaces } from "@core/docs";
import { getContext } from "../context.js";

export function register(server: FastMCP) {
  server.addTool({
    name: "list_spaces",
    description:
      "List spaces (knowledge bases) the current user can access. Each space has a stable `slug` you can pass as `space_slug` to other tools.",
    parameters: z.object({}),
    execute: async () => {
      const ctx = await getContext();
      const spaces = await listSpaces(ctx.caller.serviceClient, {
        accessibleSpaceIds: ctx.caller.accessibleSpaceIds,
      });
      if (spaces.length === 0) {
        return "No accessible spaces.";
      }
      const lines = [`Accessible spaces (${spaces.length}):`, ""];
      for (const s of spaces) {
        lines.push(`- **${s.name}** (slug: \`${s.slug}\`)`);
        if (s.description) lines.push(`    ${s.description}`);
      }
      return lines.join("\n");
    },
  });
}
