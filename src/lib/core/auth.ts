// Auth resolution for non-Next callers (CLI, MCP server).
//
// Two modes, selected by which env vars are present at call time:
//   1. service — SUPABASE_SECRET_KEY (or legacy SUPABASE_SERVICE_ROLE_KEY)
//       → bypass RLS; userId is null; every space is accessible.
//   2. user    — DOCBASED_EMAIL + DOCBASED_PASSWORD
//       → sign in via Supabase Auth; resolve accessibleSpaceIds against
//         users.is_admin and space_access.
//
// The web app does NOT use this — it resolves auth via cookies in
// src/lib/auth.ts. Both code paths converge on `accessibleSpaceIds`, which
// the core search/docs functions consume.

import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

export type CallerEnv = {
  supabaseUrl: string;
  /** Service-role / sb_secret_... key. Required for service mode. */
  supabaseSecretKey?: string;
  /** Publishable / anon key. Required for user mode (to sign in). */
  supabasePublishableKey?: string;
  /** User mode credentials. */
  userEmail?: string;
  userPassword?: string;
  /** Optional override; defaults to 'auto' (user mode if creds present, else service). */
  mode?: "auto" | "service" | "user";
};

export type ResolvedCaller = {
  mode: "service" | "user";
  /** Authenticated user id if mode === 'user', else null. */
  userId: string | null;
  /** Authenticated user email if mode === 'user', else null. */
  userEmail: string | null;
  /** Space ids the caller may read. In service mode, every space. */
  accessibleSpaceIds: string[];
  /** Space name lookup, used to populate SearchHit.spaceName etc. */
  spaceNamesById: Map<string, string>;
  /**
   * The Supabase client to use for data reads. In service mode, this is the
   * service-role client (bypasses RLS) — required because the project's RLS
   * has known recursion issues. In user mode, this is also a service-role
   * client, used after an explicit accessibleSpaceIds check (same pattern as
   * the web app — see AGENTS.md "Auth & RLS").
   */
  serviceClient: SupabaseClient;
};

export async function resolveCaller(envIn: CallerEnv): Promise<ResolvedCaller> {
  const mode = pickMode(envIn);

  if (!envIn.supabaseSecretKey) {
    throw new Error(
      "resolveCaller: SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) is required for both service and user mode.",
    );
  }
  const serviceClient = createClient(envIn.supabaseUrl, envIn.supabaseSecretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (mode === "service") {
    const { ids, names } = await loadAllSpaces(serviceClient);
    return {
      mode: "service",
      userId: null,
      userEmail: null,
      accessibleSpaceIds: ids,
      spaceNamesById: names,
      serviceClient,
    };
  }

  // user mode
  if (!envIn.supabasePublishableKey) {
    throw new Error(
      "resolveCaller: user mode requires NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or legacy NEXT_PUBLIC_SUPABASE_ANON_KEY).",
    );
  }
  if (!envIn.userEmail || !envIn.userPassword) {
    throw new Error(
      "resolveCaller: user mode requires DOCBASED_EMAIL and DOCBASED_PASSWORD.",
    );
  }

  const userClient = createClient(
    envIn.supabaseUrl,
    envIn.supabasePublishableKey,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data: signIn, error: signInErr } =
    await userClient.auth.signInWithPassword({
      email: envIn.userEmail,
      password: envIn.userPassword,
    });
  if (signInErr || !signIn.user) {
    throw new Error(
      `resolveCaller: sign-in failed — ${signInErr?.message ?? "no user"}`,
    );
  }
  const userId = signIn.user.id;

  // Look up admin flag + space_access via the service client (same reason
  // as the web app: the `users` RLS policy self-references and returns null).
  const { accessibleSpaceIds, spaceNamesById } = await loadAccessForUser(
    serviceClient,
    userId,
  );

  return {
    mode: "user",
    userId,
    userEmail: envIn.userEmail,
    accessibleSpaceIds,
    spaceNamesById,
    serviceClient,
  };
}

/**
 * Build a service-role Supabase client from env. Shared by non-Next callers
 * (CLI, MCP server) that need the RLS-bypassing client outside resolveCaller.
 */
export function serviceClientFromEnv(
  envIn: CallerEnv = callerEnvFromProcessEnv(),
): SupabaseClient {
  if (!envIn.supabaseSecretKey) {
    throw new Error(
      "serviceClientFromEnv: SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) is required.",
    );
  }
  return createClient(envIn.supabaseUrl, envIn.supabaseSecretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Resolve a caller from a known user id — no sign-in. Used by the remote (HTTP)
 * MCP server after a personal access token has been validated (see
 * src/lib/core/tokens.ts): map the token's owner to their email + space access.
 *
 * Data reads still go through the service client, after the accessibleSpaceIds
 * check (the same RLS-recursion workaround the web app and password user-mode
 * use — see AGENTS.md "Auth & RLS").
 */
export async function resolveCallerForUser(
  serviceClient: SupabaseClient,
  userId: string,
): Promise<ResolvedCaller> {
  const { data: user } = await serviceClient
    .from("users")
    .select("email")
    .eq("id", userId)
    .maybeSingle();
  const { accessibleSpaceIds, spaceNamesById } = await loadAccessForUser(
    serviceClient,
    userId,
  );
  return {
    mode: "user",
    userId,
    userEmail: (user?.email as string | null) ?? null,
    accessibleSpaceIds,
    spaceNamesById,
    serviceClient,
  };
}

function pickMode(e: CallerEnv): "service" | "user" {
  if (e.mode === "service" || e.mode === "user") return e.mode;
  // auto: prefer user mode when credentials are present.
  if (e.userEmail && e.userPassword) return "user";
  return "service";
}

async function loadAllSpaces(
  serviceClient: SupabaseClient,
): Promise<{ ids: string[]; names: Map<string, string> }> {
  const { data, error } = await serviceClient
    .from("spaces")
    .select("id, name")
    .order("name");
  if (error) throw new Error(error.message);
  const ids = (data ?? []).map((s) => s.id as string);
  const names = new Map(
    (data ?? []).map((s) => [s.id as string, s.name as string]),
  );
  return { ids, names };
}

/**
 * Given a user id, resolve the spaces they may read. Admins get every space;
 * everyone else gets their explicit `space_access` rows. Reads via the service
 * client. Shared by password user-mode (resolveCaller) and OAuth identity mode
 * (resolveCallerFromIdentity).
 */
async function loadAccessForUser(
  serviceClient: SupabaseClient,
  userId: string,
): Promise<{ accessibleSpaceIds: string[]; spaceNamesById: Map<string, string> }> {
  const { data: me } = await serviceClient
    .from("users")
    .select("is_admin")
    .eq("id", userId)
    .single();
  if (me?.is_admin === true) {
    const all = await loadAllSpaces(serviceClient);
    return { accessibleSpaceIds: all.ids, spaceNamesById: all.names };
  }

  const { data: access } = await serviceClient
    .from("space_access")
    .select("space_id")
    .eq("user_id", userId);
  const accessibleSpaceIds = (access ?? []).map((a) => a.space_id as string);
  if (accessibleSpaceIds.length === 0) {
    return { accessibleSpaceIds, spaceNamesById: new Map() };
  }
  const { data: spaces } = await serviceClient
    .from("spaces")
    .select("id, name")
    .in("id", accessibleSpaceIds);
  const spaceNamesById = new Map(
    (spaces ?? []).map((s) => [s.id as string, s.name as string]),
  );
  return { accessibleSpaceIds, spaceNamesById };
}

/**
 * Build a CallerEnv from process.env. Convenience for CLI/MCP entrypoints.
 * Throws if SUPABASE_URL is missing.
 */
export function callerEnvFromProcessEnv(): CallerEnv {
  const supabaseUrl =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) {
    throw new Error(
      "Missing SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) in environment.",
    );
  }
  return {
    supabaseUrl,
    supabaseSecretKey:
      process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY,
    supabasePublishableKey:
      process.env.SUPABASE_PUBLISHABLE_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    userEmail: process.env.DOCBASED_EMAIL,
    userPassword: process.env.DOCBASED_PASSWORD,
    mode: (process.env.DOCBASED_MODE as CallerEnv["mode"]) ?? "auto",
  };
}
