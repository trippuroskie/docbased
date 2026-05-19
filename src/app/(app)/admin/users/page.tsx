import { createServiceClient } from "@/lib/supabase/server";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { InviteForm } from "./invite-form";
import { UsersTable } from "./users-table";

export const dynamic = "force-dynamic";

export default async function UsersAdminPage() {
  const admin = createServiceClient();
  const [{ data: users }, { data: spaces }] = await Promise.all([
    admin
      .from("users")
      .select("id, email, display_name, is_admin, created_at")
      .order("created_at", { ascending: false }),
    admin.from("spaces").select("id, name").order("name"),
  ]);

  // Cross-reference last_sign_in_at from auth.users via the admin API.
  const lastSignIn = new Map<string, string | null>();
  try {
    const { data } = await admin.auth.admin.listUsers({ perPage: 200 });
    for (const u of data.users) {
      lastSignIn.set(u.id, u.last_sign_in_at ?? null);
    }
  } catch {
    // ignore — non-fatal
  }

  return (
    <main className="mx-auto w-full max-w-4xl space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
        <p className="text-sm text-muted-foreground">
          Invite teammates and manage admin privileges.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Invite a user</CardTitle>
          <CardDescription>
            New users receive an email invite. Optionally grant them initial
            access to a space.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <InviteForm
            spaces={(spaces ?? []).map((s) => ({ id: s.id, name: s.name }))}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>All users</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <UsersTable
            users={(users ?? []).map((u) => ({
              id: u.id,
              email: u.email,
              displayName: u.display_name,
              isAdmin: !!u.is_admin,
              createdAt: u.created_at,
              lastSignInAt: lastSignIn.get(u.id) ?? null,
            }))}
          />
        </CardContent>
      </Card>
    </main>
  );
}
