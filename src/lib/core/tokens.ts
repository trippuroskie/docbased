// Personal access tokens (PATs) for programmatic access — the remote MCP
// server and the CLI. Framework-free: every function takes a Supabase client
// so it works from Next server actions (service client) and the standalone MCP
// server alike.
//
// Security model: the plaintext token is returned to the caller exactly once,
// at creation. Only its SHA-256 hash is stored. Tokens are high-entropy random
// strings, so a fast hash (sha256) is the right primitive — no salt/bcrypt,
// which are for low-entropy passwords. Validation hashes the presented token
// and looks it up; revocation and expiry are checked on every use.

import { createHash, randomBytes } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

/** All docbased PATs start with this, so they're greppable + identifiable. */
export const TOKEN_PREFIX = "dbk_";
/** How many leading chars we store/display (prefix + 6 random chars). */
const PREFIX_DISPLAY_LEN = TOKEN_PREFIX.length + 6;

export type McpTokenRow = {
  id: string;
  name: string;
  tokenPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
};

export type GeneratedToken = { token: string; prefix: string; hash: string };

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateToken(): GeneratedToken {
  // 32 random bytes → 43-char base64url; ample entropy for a bearer secret.
  const token = TOKEN_PREFIX + randomBytes(32).toString("base64url");
  return {
    token,
    prefix: token.slice(0, PREFIX_DISPLAY_LEN),
    hash: hashToken(token),
  };
}

const SELECT_COLUMNS =
  "id, name, token_prefix, created_at, last_used_at, expires_at, revoked_at";

function mapRow(r: Record<string, unknown>): McpTokenRow {
  return {
    id: r.id as string,
    name: r.name as string,
    tokenPrefix: r.token_prefix as string,
    createdAt: r.created_at as string,
    lastUsedAt: (r.last_used_at as string | null) ?? null,
    expiresAt: (r.expires_at as string | null) ?? null,
    revokedAt: (r.revoked_at as string | null) ?? null,
  };
}

export async function listMcpTokens(
  client: SupabaseClient,
  userId: string,
): Promise<McpTokenRow[]> {
  const { data, error } = await client
    .from("mcp_tokens")
    .select(SELECT_COLUMNS)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => mapRow(r as Record<string, unknown>));
}

export async function createMcpToken(
  client: SupabaseClient,
  userId: string,
  name: string,
  expiresAt?: Date | null,
): Promise<{ token: string; row: McpTokenRow }> {
  const gen = generateToken();
  const { data, error } = await client
    .from("mcp_tokens")
    .insert({
      user_id: userId,
      name,
      token_prefix: gen.prefix,
      token_hash: gen.hash,
      expires_at: expiresAt ? expiresAt.toISOString() : null,
    })
    .select(SELECT_COLUMNS)
    .single();
  if (error) throw new Error(error.message);
  return { token: gen.token, row: mapRow(data as Record<string, unknown>) };
}

/** Mark a token revoked. No-op if it doesn't belong to the user or is already revoked. */
export async function revokeMcpToken(
  client: SupabaseClient,
  userId: string,
  id: string,
): Promise<void> {
  const { error } = await client
    .from("mcp_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", userId)
    .is("revoked_at", null);
  if (error) throw new Error(error.message);
}

/**
 * Validate a presented token. Returns the owning user id, or null when the
 * token is malformed, unknown, revoked, or expired. On success, best-effort
 * updates last_used_at (failure there is swallowed — it must not block auth).
 */
export async function validateMcpToken(
  client: SupabaseClient,
  token: string,
): Promise<{ userId: string } | null> {
  if (!token.startsWith(TOKEN_PREFIX)) return null;
  const hash = hashToken(token);
  const { data, error } = await client
    .from("mcp_tokens")
    .select("id, user_id, expires_at, revoked_at")
    .eq("token_hash", hash)
    .maybeSingle();
  if (error || !data) return null;
  if (data.revoked_at) return null;
  if (
    data.expires_at &&
    new Date(data.expires_at as string).getTime() < Date.now()
  ) {
    return null;
  }

  try {
    await client
      .from("mcp_tokens")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", data.id as string);
  } catch {
    // last_used_at is advisory; never block a valid token on a write failure.
  }

  return { userId: data.user_id as string };
}
