import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { stripCitationTags } from "@/lib/chat";

export const dynamic = "force-dynamic";

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: convo } = await supabase
    .from("conversations")
    .select("id, title, created_at")
    .eq("id", id)
    .single();
  if (!convo) notFound();

  const { data: msgs } = await supabase
    .from("messages")
    .select("id, role, content, model, citations, created_at")
    .eq("conversation_id", id)
    .order("created_at", { ascending: true });

  return (
    <main className="flex h-full flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl space-y-6 p-6">
        <header>
          <h1 className="text-xl font-semibold">{convo.title ?? "Conversation"}</h1>
        </header>
        <ul className="space-y-4">
          {(msgs ?? []).map((m) => (
            <li key={m.id}>
              {m.role === "user" ? (
                <div className="flex justify-end">
                  <div className="max-w-[85%] rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground">
                    {m.content}
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="whitespace-pre-wrap rounded-lg border bg-card p-3 text-sm">
                    {stripCitationTags(m.content)}
                  </div>
                  {Array.isArray(m.citations) && m.citations.length > 0 && (
                    <ul className="flex flex-wrap gap-1">
                      {(m.citations as Array<{
                        n: number;
                        documentId: string;
                        title: string;
                      }>).map((c) => (
                        <li key={`${m.id}-${c.n}`}>
                          <a href={`/doc/${c.documentId}`}>
                            <Badge variant="secondary" className="cursor-pointer">
                              {c.n}. {c.title}
                            </Badge>
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
