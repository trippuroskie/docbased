import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUserRecord } from "@/lib/auth";
import { EditForm } from "./edit-form";

export const dynamic = "force-dynamic";

export default async function EditDocPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const me = await getCurrentUserRecord();

  const { data: doc } = await supabase
    .from("documents")
    .select("id, title, space_id, processing_status, raw_content, tags")
    .eq("id", id)
    .single();

  if (!doc) notFound();
  if (doc.processing_status !== "indexed") redirect(`/doc/${id}`);

  const { data: accessRow } = await supabase
    .from("space_access")
    .select("role")
    .eq("space_id", doc.space_id)
    .eq("user_id", me?.id ?? "")
    .maybeSingle();

  const canEdit =
    me?.is_admin || accessRow?.role === "editor" || accessRow?.role === "owner";
  if (!canEdit) redirect(`/doc/${id}`);

  return (
    <main className="flex h-full flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl space-y-4 p-6">
        <h1 className="text-xl font-semibold">Edit: {doc.title}</h1>
        <EditForm
          id={doc.id}
          initialTitle={doc.title}
          initialContent={doc.raw_content ?? ""}
          initialTags={(doc.tags ?? []) as string[]}
        />
      </div>
    </main>
  );
}
