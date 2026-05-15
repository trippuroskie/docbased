import { getAccessibleSpaces } from "@/lib/auth";
import { UploadForm } from "./upload-form";

export const dynamic = "force-dynamic";

export default async function UploadPage() {
  const spaces = await getAccessibleSpaces();

  return (
    <main className="mx-auto w-full max-w-2xl space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold">Upload documents</h1>
        <p className="text-sm text-muted-foreground">
          Drop one or more files. Markdown, text, and zip files are indexed
          for semantic search. Everything else is stored and findable by
          filename and tags — full extraction lands in v1.5.
        </p>
      </header>
      <UploadForm spaces={spaces.map((s) => ({ id: s.id, name: s.name }))} />
    </main>
  );
}
