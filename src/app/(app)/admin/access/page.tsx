import { createServiceClient } from "@/lib/supabase/server";
import { AccessMatrix } from "./access-matrix";

export const dynamic = "force-dynamic";

export default async function AccessAdminPage() {
  const admin = createServiceClient();
  const [{ data: users }, { data: spaces }, { data: rows }] = await Promise.all([
    admin.from("users").select("id, email").order("email"),
    admin.from("spaces").select("id, name").order("name"),
    admin.from("space_access").select("space_id, user_id, role"),
  ]);

  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold">Access</h1>
        <p className="text-sm text-muted-foreground">
          Per-space role-based access. Set role to <em>none</em> to revoke.
        </p>
      </header>
      <AccessMatrix
        users={users ?? []}
        spaces={spaces ?? []}
        grants={rows ?? []}
      />
    </main>
  );
}
