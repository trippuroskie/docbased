import { createClient, createServiceClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { cache } from "react";
import type { User } from "@supabase/supabase-js";

export const getSession = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

export async function requireUser() {
  const user = await getSession();
  if (!user) redirect("/login");
  return user;
}

export const getCurrentUserRecord = cache(async () => {
  const user = await requireUser();
  // Use service client: the user is already authenticated; reading their own
  // row shouldn't depend on RLS, and we've seen RLS silently return null here.
  const admin = createServiceClient();
  const { data } = await admin
    .from("users")
    .select("id, email, display_name, is_admin")
    .eq("id", user.id)
    .single();
  return data;
});

export async function requireAdmin() {
  const me = await getCurrentUserRecord();
  if (!me?.is_admin) redirect("/");
  return me;
}

/**
 * Admin gate for API route handlers. Validates the session with the user
 * client, then reads `is_admin` via the SERVICE client — the `users` SELECT
 * RLS policy self-references and silently returns null, so checking admin
 * through the user client 403s even real admins (see AGENTS.md "Auth & RLS").
 *
 * Returns a discriminated union instead of redirecting (a redirect in an API
 * route yields a 307, not a clean 401/403). Usage:
 *
 *   const gate = await requireAdminApi();
 *   if (!gate.ok) return gate.response;
 *   const { user } = gate;
 */
export type AdminGate =
  | { ok: true; user: User; me: { id: string; is_admin: boolean } }
  | { ok: false; response: NextResponse };

export async function requireAdminApi(): Promise<AdminGate> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "unauthorized" }, { status: 401 }),
    };
  }
  const admin = createServiceClient();
  const { data: me } = await admin
    .from("users")
    .select("id, is_admin")
    .eq("id", user.id)
    .single();
  if (!me?.is_admin) {
    return {
      ok: false,
      response: NextResponse.json({ error: "forbidden" }, { status: 403 }),
    };
  }
  return {
    ok: true,
    user,
    me: { id: me.id as string, is_admin: me.is_admin as boolean },
  };
}

export const getAccessibleSpaces = cache(async () => {
  const user = await requireUser();
  const me = await getCurrentUserRecord();
  const admin = createServiceClient();

  // Admins see every space.
  if (me?.is_admin) {
    const { data } = await admin
      .from("spaces")
      .select("id, slug, name, description")
      .order("name");
    return (data ?? []).map((s) => ({
      id: s.id as string,
      slug: s.slug as string,
      name: s.name as string,
      description: s.description as string | null,
      role: "owner" as string,
    }));
  }

  // Non-admins: spaces they have explicit access to.
  const { data: access } = await admin
    .from("space_access")
    .select("space_id, role")
    .eq("user_id", user.id);
  const spaceIds = (access ?? []).map((a) => a.space_id as string);
  if (spaceIds.length === 0) return [];

  const roleById = new Map(
    (access ?? []).map((a) => [a.space_id as string, a.role as string]),
  );
  const { data: spaces } = await admin
    .from("spaces")
    .select("id, slug, name, description")
    .in("id", spaceIds)
    .order("name");
  return (spaces ?? []).map((s) => ({
    id: s.id as string,
    slug: s.slug as string,
    name: s.name as string,
    description: s.description as string | null,
    role: roleById.get(s.id as string) ?? "viewer",
  }));
});
