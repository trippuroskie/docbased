// /docbased-ask — a Prompt template the MCP client can invoke as a slash
// command. It primes the model with the docbased SYSTEM_PROMPT and the
// user's question; the model is then expected to call search_documents
// (and friends) on its own to compose an answer.

import type { FastMCP } from "fastmcp";
import { SYSTEM_PROMPT } from "@core/prompt";

export function register(server: FastMCP) {
  server.addPrompt({
    name: "docbased-ask",
    description:
      "Ask the docbased knowledge base a question. The model should use the search_documents / get_document / list_documents tools to ground its answer.",
    arguments: [
      {
        name: "question",
        description: "The question to research.",
        required: true,
      },
      {
        name: "space_slug",
        description: "Optional: restrict tools to a single space.",
        required: false,
      },
    ],
    load: async ({ question, space_slug }) => {
      const hint = space_slug
        ? `\n\nRestrict every tool call to space_slug="${space_slug}".`
        : "";
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `${SYSTEM_PROMPT}${hint}\n\nQuestion: ${question}`,
            },
          },
        ],
      };
    },
  });
}
