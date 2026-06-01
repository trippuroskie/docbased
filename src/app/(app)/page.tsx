import {
  getAccessibleSpaces,
  getCurrentUserRecord,
  requireUser,
} from "@/lib/auth";
import { getSpaceTree } from "@/lib/tree";
import { UnifiedHub } from "@/components/docbased/unified-hub";
import type { SpaceWithTree } from "@/components/docbased/types";
import {
  effectiveChatModels,
  effectiveDefaultChatModel,
  getUserSettings,
} from "@/lib/settings";

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
  searchParams: Promise<{ doc?: string; q?: string; conv?: string }>;
}) {
  const { doc, q, conv } = await searchParams;
  const user = await requireUser();
  // The (app) layout also fetches user/spaces, but Next dedupes these calls
  // because `getCurrentUserRecord` and `getAccessibleSpaces` use React's
  // `cache()` wrapper.
  const [me, accessible, settings] = await Promise.all([
    getCurrentUserRecord(),
    getAccessibleSpaces(),
    getUserSettings(user.id),
  ]);
  const trees = await Promise.all(accessible.map((s) => getSpaceTree(s.id)));

  const enabledChatModels = effectiveChatModels(settings);
  const defaultChatModel = effectiveDefaultChatModel(settings);

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
      initialDocId={doc}
      initialQuery={q}
      initialConversationId={conv}
      enabledChatModels={enabledChatModels}
      defaultChatModel={defaultChatModel}
    />
  );
}
