"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Sparkles, FileText } from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import type { SearchHit } from "@/lib/search";

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [hits, setHits] = React.useState<SearchHit[]>([]);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  React.useEffect(() => {
    if (!query.trim()) {
      setHits([]);
      return;
    }
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/search?q=${encodeURIComponent(query)}&limit=5&rerank=false`,
        );
        const json = await res.json();
        setHits(json.hits ?? []);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  const goToDoc = (id: string) => {
    setOpen(false);
    router.push(`/doc/${id}`);
  };

  const askAi = () => {
    setOpen(false);
    router.push(`/chat/new?q=${encodeURIComponent(query)}`);
  };

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput
        placeholder="Search the knowledge hub…"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        {loading && <div className="p-3 text-xs text-muted-foreground">Searching…</div>}
        {!loading && query && hits.length === 0 && (
          <CommandEmpty>No results.</CommandEmpty>
        )}
        {hits.length > 0 && (
          <CommandGroup heading="Documents">
            {hits.map((h) => (
              <CommandItem key={h.chunkId} onSelect={() => goToDoc(h.documentId)}>
                <FileText className="mr-2 h-4 w-4 text-muted-foreground" />
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-sm">{h.documentTitle}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {h.spaceName}
                    {h.headingPath.length ? ` · ${h.headingPath.join(" → ")}` : ""}
                  </span>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {query && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Actions">
              <CommandItem onSelect={askAi}>
                <Sparkles className="mr-2 h-4 w-4" />
                Ask AI: <span className="ml-1 italic">{query}</span>
              </CommandItem>
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
