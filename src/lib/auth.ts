import { createClient, createServiceClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { cache } from "react";

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
