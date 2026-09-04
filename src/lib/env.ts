// Centralized env access. Fail loud at boot, never at first request.
//
// IMPORTANT: NEXT_PUBLIC_* vars MUST be referenced as static property accesses
// (process.env.NEXT_PUBLIC_FOO), not dynamic indexing (process.env[name]).
// Next.js / Turbopack only inlines them into the client bundle when accessed
// statically — dynamic indexing produces `undefined` in the browser.

// --- Client-safe (inlined into browser bundle by Next.js) ---

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (!supabaseUrl) {
  throw new Error("Missing required env var: NEXT_PUBLIC_SUPABASE_URL");
}

// Supabase rotated key naming in 2025: new keys are sb_publishable_... and
// sb_secret_..., exposed under NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and
// SUPABASE_SECRET_KEY. The legacy JWT-style anon/service_role keys still
// work through end of 2026. Accept either, prefer the new names.
const supabasePublishableKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!supabasePublishableKey) {
  throw new Error(
    "Missing Supabase client key: set NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or legacy NEXT_PUBLIC_SUPABASE_ANON_KEY).",
  );
}

const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

// Optional single canonical host (e.g. "www.example.com"). When set, page
// requests to the bare apex are 308'd here by src/proxy.ts. Unset = no
// canonicalization, which is the right default for local dev and previews.
const canonicalHost = process.env.NEXT_PUBLIC_CANONICAL_HOST ?? null;

// --- Server-only (never inlined into the browser; reading them in client
// code returns undefined, which is what we want) ---

const supabaseSecretKey =
  process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const databaseUrl = process.env.DATABASE_URL;
const openrouterApiKey = process.env.OPENROUTER_API_KEY;
const embeddingModel =
  process.env.EMBEDDING_MODEL ?? "openai/text-embedding-3-small";
const defaultChatModel =
  process.env.DEFAULT_CHAT_MODEL ?? "anthropic/claude-sonnet-4.5";
const rerankerModel = process.env.RERANKER_MODEL ?? "cohere/rerank-3.5";
const rerankerEnabled = (process.env.RERANKER_ENABLED ?? "true") === "true";
const monthlySpendCeiling = Number(process.env.MONTHLY_SPEND_CEILING ?? "50");
const chatDailyLimit = Number(process.env.CHAT_DAILY_LIMIT ?? "50");

export const env = {
  supabaseUrl,
  /** Client-safe publishable key (sb_publishable_... or legacy anon JWT). */
  supabasePublishableKey,
  /** Server-only secret key (sb_secret_... or legacy service_role JWT). Bypasses RLS. */
  supabaseSecretKey,
  databaseUrl,
  openrouterApiKey,
  embeddingModel,
  defaultChatModel,
  rerankerModel,
  rerankerEnabled,
  monthlySpendCeiling,
  chatDailyLimit,
  appUrl,
  canonicalHost,
};

// Allowlist of user-selectable chat models in the UI.
export const CHAT_MODEL_ALLOWLIST = [
  "anthropic/claude-sonnet-4.5",
  "anthropic/claude-opus-4",
  "anthropic/claude-haiku-4.5",
  "openai/gpt-5",
  "google/gemini-2.5-pro",
] as const;

export type ChatModel = (typeof CHAT_MODEL_ALLOWLIST)[number];
