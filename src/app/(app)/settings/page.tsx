import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { getCurrentUserRecord, requireUser } from "@/lib/auth";
import { getUserSettings } from "@/lib/settings";
import { createServiceClient } from "@/lib/supabase/server";
import { listMcpTokens } from "@/lib/core/tokens";
import { env } from "@/lib/env";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SignOutButton } from "./sign-out-button";
import { ModelPreferences } from "./model-preferences";
import { AccessTokens } from "./access-tokens";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await requireUser();
  const [me, settings, tokens] = await Promise.all([
    getCurrentUserRecord(),
    getUserSettings(user.id),
    listMcpTokens(createServiceClient(), user.id),
  ]);

  return (
    <main className="flex-1 min-h-0 overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl space-y-6 p-6">
        <nav
          aria-label="Breadcrumb"
          className="flex items-center gap-1 text-xs text-muted-foreground"
        >
          <Link href="/" className="hover:text-foreground hover:underline">
            docbased
          </Link>
          <ChevronRight className="size-3" />
          <span className="text-foreground">Settings</span>
        </nav>

        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
          <p className="text-sm text-muted-foreground">Your account.</p>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>Account</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <dl className="grid grid-cols-[120px_1fr] gap-y-2 text-sm">
              <dt className="text-muted-foreground">Name</dt>
              <dd>{me?.display_name ?? "—"}</dd>
              <dt className="text-muted-foreground">Email</dt>
              <dd>{me?.email ?? "—"}</dd>
              <dt className="text-muted-foreground">Role</dt>
              <dd>{me?.is_admin ? "Admin" : "Member"}</dd>
            </dl>
          </CardContent>
        </Card>

        {me?.is_admin && (
          <Card>
            <CardHeader>
              <CardTitle>Admin</CardTitle>
              <CardDescription>
                Workspace, user, and access management live in the admin
                console.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <Link
                href="/admin"
                className="inline-flex h-8 items-center gap-1.5 rounded-md bg-secondary px-3 text-xs font-medium hover:bg-secondary/80"
              >
                Open admin console
                <ChevronRight className="size-3" />
              </Link>
            </CardContent>
          </Card>
        )}

        <ModelPreferences initial={settings} />

        <AccessTokens initial={tokens} mcpUrl={`${env.appUrl}/mcp`} />

        <Card>
          <CardHeader>
            <CardTitle>Session</CardTitle>
            <CardDescription>
              Signing out clears your session on this device.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <SignOutButton />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
