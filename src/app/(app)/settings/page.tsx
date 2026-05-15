import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { getCurrentUserRecord, requireUser } from "@/lib/auth";
import { getUserSettings } from "@/lib/settings";
import { SignOutButton } from "./sign-out-button";
import { ModelPreferences } from "./model-preferences";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await requireUser();
  const [me, settings] = await Promise.all([
    getCurrentUserRecord(),
    getUserSettings(user.id),
  ]);

  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 p-6">
      <nav
        aria-label="Breadcrumb"
        className="flex items-center gap-1 text-xs text-muted-foreground"
      >
        <Link href="/" className="hover:text-foreground hover:underline">
          Knowledge Hub
        </Link>
        <ChevronRight className="size-3" />
        <span className="text-foreground">Settings</span>
      </nav>

      <header>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Your account.
        </p>
      </header>

      <section className="rounded-lg border bg-card p-4 space-y-3">
        <h2 className="text-sm font-semibold">Account</h2>
        <dl className="grid grid-cols-[120px_1fr] gap-y-2 text-sm">
          <dt className="text-muted-foreground">Name</dt>
          <dd>{me?.display_name ?? "—"}</dd>
          <dt className="text-muted-foreground">Email</dt>
          <dd>{me?.email ?? "—"}</dd>
          <dt className="text-muted-foreground">Role</dt>
          <dd>{me?.is_admin ? "Admin" : "Member"}</dd>
        </dl>
      </section>

      <ModelPreferences initial={settings} />

      {me?.is_admin && (
        <section className="rounded-lg border bg-card p-4 space-y-2">
          <h2 className="text-sm font-semibold">Admin</h2>
          <p className="text-xs text-muted-foreground">
            Workspace, user, and access management live in the admin console.
          </p>
          <Link
            href="/admin"
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-secondary px-3 text-xs font-medium hover:bg-secondary/80"
          >
            Open admin console
            <ChevronRight className="size-3" />
          </Link>
        </section>
      )}

      <section className="rounded-lg border bg-card p-4 space-y-2">
        <h2 className="text-sm font-semibold">Session</h2>
        <p className="text-xs text-muted-foreground">
          Signing out clears your session on this device.
        </p>
        <SignOutButton />
      </section>
    </main>
  );
}
