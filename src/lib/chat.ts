// Web-app wrapper. Portable prompt helpers live in @/lib/core/prompt so they
// can be reused by the CLI and the docbased-mcp package without dragging in
// Next.js-only modules.

import { CHAT_MODEL_ALLOWLIST, type ChatModel } from "@/lib/env";

export {
  SYSTEM_PROMPT,
  buildContextBlock,
  buildDocumentIndex,
  parseCitations,
  stripCitationTags,
  type IndexEntry,
  type ParsedCitation,
} from "@/lib/core/prompt";

export function isAllowedModel(model: string): model is ChatModel {
  return (CHAT_MODEL_ALLOWLIST as readonly string[]).includes(model);
}
