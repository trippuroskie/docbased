import Link from "next/link";
import { ChevronRight, ExternalLink } from "lucide-react";
import { createServiceClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

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

  const tiles: { label: string; value: number | string; href?: string }[] = [
    { label: "Spaces", value: spaceCount ?? 0, href: "/admin/spaces" },
    { label: "Users", value: userCount ?? 0, href: "/admin/users" },
    { label: "Documents (active)", value: docCount ?? 0 },
    { label: "Indexed", value: indexedCount ?? 0 },
    { label: "Chunks", value: chunkCount ?? 0 },
    { label: "Monthly spend ceiling", value: `$${env.monthlySpendCeiling}` },
  ];

  return (
    <main className="mx-auto w-full max-w-4xl space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
        <p className="text-sm text-muted-foreground">
          Workspace, user, and content overview.
        </p>
      </header>

      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {tiles.map((t) => (
          <li key={t.label}>
            {t.href ? (
              <Link href={t.href} className="block">
                <StatCard {...t} interactive />
              </Link>
            ) : (
              <StatCard {...t} />
            )}
          </li>
        ))}
      </ul>

      <Card>
        <CardHeader>
          <CardTitle>Quick links</CardTitle>
          <CardDescription>Common admin shortcuts.</CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <ul className="divide-y divide-border text-sm">
            <QuickLink href="/admin/upload" label="Upload documents" />
            <QuickLink href="/admin/audit" label="View audit log" />
            <QuickLink
              href="https://openrouter.ai/activity"
              label="OpenRouter usage dashboard"
              external
            />
          </ul>
        </CardContent>
      </Card>
    </main>
  );
}

function StatCard({
  label,
  value,
  interactive,
}: {
  label: string;
  value: number | string;
  interactive?: boolean;
}) {
  return (
    <Card
      className={
        interactive
          ? "p-4 transition-colors hover:bg-accent"
          : "p-4"
      }
    >
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
    </Card>
  );
}

function QuickLink({
  href,
  label,
  external,
}: {
  href: string;
  label: string;
  external?: boolean;
}) {
  const className =
    "flex items-center justify-between py-2 text-foreground transition-colors hover:text-primary";
  const icon = external ? (
    <ExternalLink className="size-3.5 text-muted-foreground" />
  ) : (
    <ChevronRight className="size-3.5 text-muted-foreground" />
  );
  return (
    <li>
      {external ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className={className}
        >
          <span>{label}</span>
          {icon}
        </a>
      ) : (
        <Link href={href} className={className}>
          <span>{label}</span>
          {icon}
        </Link>
      )}
    </li>
  );
}
