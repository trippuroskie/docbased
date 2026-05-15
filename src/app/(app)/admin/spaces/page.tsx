import { createServiceClient } from "@/lib/supabase/server";
import { SpacesManager } from "./spaces-manager";

export const dynamic = "force-dynamic";

export default async function SpacesAdminPage() {
  const admin = createServiceClient();
  const { data: spaces } = await admin
    .from("spaces")
    .select("id, slug, name, description")
    .order("name");
  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold">Spaces</h1>
      </header>
      <SpacesManager initial={spaces ?? []} />
    </main>
  );
}
