import Link from "next/link";
import { createServiceClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export default async function AdminHomePage() {
  const admin = createServiceClient();
  const [
    { count: docCount },
    { count: indexedCount },
    { count: spaceCount },
    { count: userCount },
    { count: chunkCount },
  ] = await Promise.all([
    admin.from("documents").select("id", { count: "exact", head: true }).is("deleted_at", null),
    admin
      .from("documents")
      .select("id", { count: "exact", head: true })
      .eq("processing_status", "indexed")
      .is("deleted_at", null),
    admin.from("spaces").select("id", { count: "exact", head: true }),
    admin.from("users").select("id", { count: "exact", head: true }),
    admin.from("chunks").select("id", { count: "exact", head: true }),
  ]);

  const tiles = [
    { label: "Spaces", value: spaceCount ?? 0, href: "/admin/spaces" },
    { label: "Users", value: userCount ?? 0, href: "/admin/users" },
    { label: "Documents (active)", value: docCount ?? 0 },
    { label: "Indexed", value: indexedCount ?? 0 },
    { label: "Chunks", value: chunkCount ?? 0 },
    { label: "Monthly spend ceiling", value: `$${env.monthlySpendCeiling}` },
  ];

  return (
    <main className="mx-auto w-full max-w-4xl space-y-6 p-6">
      <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>

      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {tiles.map((t) => (
          <li key={t.label}>
            {t.href ? (
              <Link
                href={t.href}
                className="block rounded-lg border p-4 transition hover:bg-accent"
              >
                <Tile {...t} />
              </Link>
            ) : (
              <div className="rounded-lg border p-4">
                <Tile {...t} />
              </div>
            )}
          </li>
        ))}
      </ul>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Quick links
        </h2>
        <ul className="space-y-1 text-sm">
          <li>
            <Link href="/admin/upload" className="text-primary hover:underline">
              Upload documents
            </Link>
          </li>
          <li>
            <Link href="/admin/audit" className="text-primary hover:underline">
              View audit log
            </Link>
          </li>
          <li>
            <a
              href="https://openrouter.ai/activity"
              target="_blank"
              rel="noreferrer"
              className="text-primary hover:underline"
            >
              OpenRouter usage dashboard ↗
            </a>
          </li>
        </ul>
      </section>
    </main>
  );
}

function Tile({ label, value }: { label: string; value: number | string }) {
  return (
    <>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
    </>
  );
}
