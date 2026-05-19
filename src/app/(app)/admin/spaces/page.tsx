import { createServiceClient } from "@/lib/supabase/server";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CreateSpaceForm, SpacesList } from "./spaces-manager";

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
        <h1 className="text-2xl font-semibold tracking-tight">Spaces</h1>
        <p className="text-sm text-muted-foreground">
          Workspaces group related documents. Each one has its own access
          control matrix.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Create a space</CardTitle>
          <CardDescription>
            The slug becomes part of the URL — leave it blank to auto-generate
            from the name.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <CreateSpaceForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>All spaces</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <SpacesList spaces={spaces ?? []} />
        </CardContent>
      </Card>
    </main>
  );
}
