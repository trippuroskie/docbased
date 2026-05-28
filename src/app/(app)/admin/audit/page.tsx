import { createServiceClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const dynamic = "force-dynamic";

type SP = Promise<{
  action?: string;
  actor?: string;
  since?: string;
  source?: string;
  agent?: string;
}>;

type AuditMetadata = {
  source?: "web" | "cli" | "mcp";
  agent_authored?: boolean;
  agent_name?: string;
  [k: string]: unknown;
};

function readMeta(raw: unknown): AuditMetadata {
  if (raw && typeof raw === "object") return raw as AuditMetadata;
  return {};
}

function sourceLabel(meta: AuditMetadata): "web" | "cli" | "mcp" {
  return meta.source ?? "web";
}

function isAgent(meta: AuditMetadata): boolean {
  return meta.agent_authored === true || meta.source === "mcp";
}

const SOURCE_BADGE_VARIANT: Record<
  "web" | "cli" | "mcp",
  "secondary" | "outline" | "default"
> = {
  web: "outline",
  cli: "secondary",
  mcp: "default",
};

export default async function AuditPage({ searchParams }: { searchParams: SP }) {
  const params = await searchParams;
  const admin = createServiceClient();

  let q = admin
    .from("audit_log")
    .select("id, actor_id, action, target_type, target_id, metadata, created_at")
    .order("created_at", { ascending: false })
    .limit(200);

  if (params.action) q = q.eq("action", params.action);
  if (params.actor) q = q.eq("actor_id", params.actor);
  if (params.since) q = q.gte("created_at", params.since);
  if (params.source) q = q.eq("metadata->>source", params.source);
  if (params.agent === "true") q = q.eq("metadata->>agent_authored", "true");

  const { data: rows } = await q;
  const actorIds = Array.from(new Set((rows ?? []).map((r) => r.actor_id).filter(Boolean)));
  const { data: actors } = actorIds.length
    ? await admin.from("users").select("id, email").in("id", actorIds)
    : { data: [] };
  const emailById = new Map((actors ?? []).map((a) => [a.id, a.email]));

  return (
    <main className="mx-auto w-full max-w-5xl space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Audit log</h1>
        <p className="text-sm text-muted-foreground">Most recent 200 events.</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Events</CardTitle>
          <CardDescription>
            Newest first. Filterable via ?action / ?actor / ?since / ?source /
            ?agent=true query params.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Target</TableHead>
                <TableHead>Metadata</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(rows ?? []).map((r) => {
                const meta = readMeta(r.metadata);
                const src = sourceLabel(meta);
                const agent = isAgent(meta);
                return (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {r.created_at
                        ? new Date(r.created_at).toLocaleString()
                        : "—"}
                    </TableCell>
                    <TableCell className="text-xs">
                      {r.actor_id
                        ? (emailById.get(r.actor_id) ?? r.actor_id)
                        : "system"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={SOURCE_BADGE_VARIANT[src]}>{src}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <Badge variant="secondary">{r.action}</Badge>
                        {agent && (
                          <Badge
                            variant="default"
                            title={
                              meta.agent_name
                                ? `agent: ${meta.agent_name}`
                                : "agent activity"
                            }
                          >
                            agent
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs">
                      {r.target_type} · {r.target_id?.slice(0, 8)}
                    </TableCell>
                    <TableCell className="max-w-md truncate font-mono text-[11px] text-muted-foreground">
                      {JSON.stringify(r.metadata)}
                    </TableCell>
                  </TableRow>
                );
              })}
              {(rows ?? []).length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="text-center text-sm text-muted-foreground"
                  >
                    No audit events match these filters.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </main>
  );
}
