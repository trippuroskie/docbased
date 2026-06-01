import type { TreeNode } from "@/lib/tree";

export type SpaceWithTree = {
  id: string;
  slug: string;
  name: string;
  role: string;
  color: string;
  tree: TreeNode[];
};

export type DocPayload = {
  id: string;
  title: string;
  spaceId: string;
  path: string;
  rawContent: string;
  tags: string[];
  processingStatus: "indexed" | "metadata_only" | "failed" | "pending";
  originalFilename: string | null;
  downloadUrl: string | null;
  lastEditedAt: string | null;
  lastEditedByName: string | null;
  isStale: boolean;
  canEdit: boolean;
  backlinks: Array<{
    id: string;
    title: string;
    path: string;
    spaceName: string;
  }>;
  wikilinks: Record<string, string>;
};

export type ChatUser = {
  name: string;
  initials: string;
  isAdmin: boolean;
};
