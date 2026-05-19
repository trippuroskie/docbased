import { getAccessibleSpaces } from "@/lib/auth";
import { getSpaceTree, type TreeNode } from "@/lib/tree";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { UploadForm } from "./upload-form";

export const dynamic = "force-dynamic";

export default async function UploadPage() {
  const spaces = await getAccessibleSpaces();
  const trees = await Promise.all(spaces.map((s) => getSpaceTree(s.id)));

  const spacesWithFolders = spaces.map((s, i) => ({
    id: s.id,
    name: s.name,
    folders: collectFolderPaths(trees[i]),
  }));

  return (
    <main className="mx-auto w-full max-w-2xl space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          Upload documents
        </h1>
        <p className="text-sm text-muted-foreground">
          Drop one or more files. Markdown, text, Word (.docx), and zip files
          are indexed for semantic search. Everything else is stored and
          findable by filename and tags — full extraction lands in v1.5.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Files</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <UploadForm spaces={spacesWithFolders} />
        </CardContent>
      </Card>
    </main>
  );
}

function collectFolderPaths(nodes: TreeNode[]): string[] {
  const out: string[] = [];
  const walk = (ns: TreeNode[]) => {
    for (const n of ns) {
      if (n.type === "folder") {
        out.push(n.path);
        walk(n.children);
      }
    }
  };
  walk(nodes);
  return out.sort((a, b) => a.localeCompare(b));
}
