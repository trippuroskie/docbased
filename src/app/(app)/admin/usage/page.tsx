import { createServiceClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function UsagePage() {
  const admin = createServiceClient();

  // Last 14 days of chat usage by user.
  const since = new Date();
  since.setDate(since.getDate() - 14);
  const sinceDate = since.toISOString().slice(0, 10);

  const [{ data: usage }, { data: users }] = await Promise.all([
    admin
      .from("chat_usage")
      .select("user_id, day, count")
      .gte("day", sinceDate)
      .order("day", { ascending: false }),
    admin.from("users").select("id, email"),
  ]);

  const emailById = new Map((users ?? []).map((u) => [u.id, u.email]));

  // Per-user totals over the window.
  const totals = new Map<string, number>();
  for (const row of usage ?? []) {
    totals.set(row.user_id, (totals.get(row.user_id) ?? 0) + row.count);
  }
  const rows = Array.from(totals.entries())
    .map(([id, count]) => ({ id, email: emailById.get(id) ?? id, count }))
    .sort((a, b) => b.count - a.count);

  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Usage</h1>
        <p className="text-sm text-muted-foreground">
          Chat usage over the last 14 days. Daily cap per user:{" "}
          {env.chatDailyLimit}. Monthly OpenRouter spend ceiling: $
          {env.monthlySpendCeiling}.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>OpenRouter</CardTitle>
          <CardDescription>
            Live spend and per-model breakdown live in the OpenRouter dashboard.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <Button
            size="sm"
            variant="outline"
            nativeButton={false}
            render={
              <a
                href="https://openrouter.ai/activity"
                target="_blank"
                rel="noreferrer"
              />
            }
          >
            Open OpenRouter dashboard ↗
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Per-user chat messages (14d)</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead className="text-right">Messages</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{r.email}</TableCell>
                  <TableCell className="text-right">{r.count}</TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={2}
                    className="text-center text-sm text-muted-foreground"
                  >
                    No chat activity in the last 14 days.
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
