import {
  getAccessibleSpaces,
  getCurrentUserRecord,
  requireUser,
} from "@/lib/auth";
import { getSpaceTree } from "@/lib/tree";
import { AppShell } from "@/components/docbased/app-shell";
import type { SpaceWithTree } from "@/components/docbased/types";

export const dynamic = "force-dynamic";

const SPACE_PALETTE = [
  "bg-indigo-500",
  "bg-emerald-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-cyan-500",
  "bg-violet-500",
  "bg-fuchsia-500",
  "bg-orange-500",
];

function colorFor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return SPACE_PALETTE[Math.abs(h) % SPACE_PALETTE.length];
}

export default async function AppShellLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Sidebar lives at the layout so it persists across all (app) routes.
  // Fetch the same data the sidebar needs (spaces + trees, current user) here
  // — every (app) page already needs auth anyway, so it's the same cost.
  await requireUser();
  const [me, accessible] = await Promise.all([
    getCurrentUserRecord(),
    getAccessibleSpaces(),
  ]);
  const trees = await Promise.all(accessible.map((s) => getSpaceTree(s.id)));

  const spacesWithTrees: SpaceWithTree[] = accessible.map((s, i) => ({
    id: s.id,
    slug: s.slug,
    name: s.name,
    role: s.role,
    color: colorFor(s.id),
    tree: trees[i],
  }));

  // Lock this route group to viewport height with scroll suppression so the
  // chat hub's fixed three-pane layout doesn't induce page-level scroll. The
  // root <body> allows normal scroll for /docs and other non-app routes —
  // this wrapper re-imposes the fixed-viewport model for /(app)/*. AppShell
  // owns a flex-row with the sidebar on the left and a flex-col main area on
  // the right; plain pages (Settings, Admin, …) render scrollable content
  // inside that main area, and the hub renders an h-full child that exactly
  // fills it.
  return (
    <div className="h-screen overflow-hidden">
      <AppShell
        spacesWithTrees={spacesWithTrees}
        isAdmin={me?.is_admin ?? false}
        userDisplayName={me?.display_name ?? null}
        userEmail={me?.email ?? null}
      >
        {children}
      </AppShell>
    </div>
  );
}
