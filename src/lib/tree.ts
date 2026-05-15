import { createServiceClient } from "@/lib/supabase/server";

export type DocNode = {
  type: "doc";
  id: string;
  title: string;
  path: string;
  status: "indexed" | "metadata_only" | "failed" | "pending";
};

export type FolderNode = {
  type: "folder";
  name: string;
  path: string;
  children: TreeNode[];
};

export type TreeNode = DocNode | FolderNode;

export async function getSpaceTree(spaceId: string): Promise<TreeNode[]> {
  // Service client: space-level access is enforced upstream (getAccessibleSpaces).
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("documents")
    .select("id, title, path, processing_status")
    .eq("space_id", spaceId)
    .is("deleted_at", null)
    .order("path");

  return buildTree(
    (data ?? []).map((d) => ({
      id: d.id as string,
      title: d.title as string,
      path: d.path as string,
      status: d.processing_status as DocNode["status"],
    })),
  );
}

function buildTree(
  docs: Array<{ id: string; title: string; path: string; status: DocNode["status"] }>,
): TreeNode[] {
  const root: FolderNode = { type: "folder", name: "", path: "", children: [] };

  for (const d of docs) {
    const segments = d.path.split("/").filter(Boolean);
    let cursor = root;
    for (let i = 0; i < segments.length - 1; i++) {
      const seg = segments[i];
      const fullPath = segments.slice(0, i + 1).join("/");
      let next = cursor.children.find(
        (c): c is FolderNode => c.type === "folder" && c.name === seg,
      );
      if (!next) {
        next = { type: "folder", name: seg, path: fullPath, children: [] };
        cursor.children.push(next);
      }
      cursor = next;
    }
    cursor.children.push({
      type: "doc",
      id: d.id,
      title: d.title,
      path: d.path,
      status: d.status,
    });
  }

  sort(root);
  return root.children;
}

function sort(folder: FolderNode) {
  folder.children.sort((a, b) => {
    if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
    const an = a.type === "folder" ? a.name : a.title;
    const bn = b.type === "folder" ? b.name : b.title;
    return an.localeCompare(bn);
  });
  for (const c of folder.children) {
    if (c.type === "folder") sort(c);
  }
}
