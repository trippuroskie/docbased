import { getAccessibleSpaces, getCurrentUserRecord } from "@/lib/auth";
import { getSpaceTree } from "@/lib/tree";
import { UnifiedHub } from "@/components/knowledge-hub/unified-hub";
import type { SpaceWithTree } from "@/components/knowledge-hub/types";

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

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ doc?: string; q?: string }>;
}) {
  const { doc, q } = await searchParams;
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
  const spaces = spacesWithTrees.map((s) => ({
    id: s.id,
    name: s.name,
    color: s.color,
  }));

  return (
    <UnifiedHub
      spaces={spaces}
      spacesWithTrees={spacesWithTrees}
      isAdmin={me?.is_admin ?? false}
      initialDocId={doc}
      initialQuery={q}
    />
  );
}
