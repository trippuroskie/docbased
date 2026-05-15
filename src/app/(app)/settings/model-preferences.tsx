"use client";

import * as React from "react";
import { Check, Loader2, Search, Sparkles, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import type { OpenRouterModel } from "@/lib/ai/openrouter-models";
import { CHAT_MODEL_ALLOWLIST } from "@/lib/env";

type EmbeddingOption = { id: string; name: string; provider: string; dimensions: number };
type RerankerOption = { id: string; name: string; provider: string };

type Settings = {
  chatModels: string[];
  defaultChatModel: string | null;
  embeddingModel: string | null;
  rerankerModel: string | null;
};

const PROVIDER_ANY = "__any__";

export function ModelPreferences({ initial }: { initial: Settings }) {
  const [settings, setSettings] = React.useState<Settings>(initial);
  const [catalog, setCatalog] = React.useState<{
    chat: OpenRouterModel[];
    embeddings: EmbeddingOption[];
    rerankers: RerankerOption[];
  } | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [providerFilter, setProviderFilter] = React.useState<string>(PROVIDER_ANY);
  const [search, setSearch] = React.useState("");

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch("/api/openrouter/models");
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = (await resp.json()) as {
          chatModels: OpenRouterModel[];
          embeddingModels: EmbeddingOption[];
          rerankerModels: RerankerOption[];
        };
        if (cancelled) return;
        setCatalog({
          chat: data.chatModels,
          embeddings: data.embeddingModels,
          rerankers: data.rerankerModels,
        });
      } catch (err) {
        toast.error(`Could not load OpenRouter models: ${(err as Error).message}`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const chatModels = catalog?.chat ?? [];
  const providers = React.useMemo(() => {
    const set = new Set<string>();
    for (const m of chatModels) set.add(m.provider);
    return Array.from(set).sort();
  }, [chatModels]);

  const filteredChatModels = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    return chatModels.filter((m) => {
      if (providerFilter !== PROVIDER_ANY && m.provider !== providerFilter) return false;
      if (!q) return true;
      return (
        m.id.toLowerCase().includes(q) ||
        m.name.toLowerCase().includes(q) ||
        (m.description?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [chatModels, providerFilter, search]);

  const toggleChatModel = (id: string) => {
    setSettings((prev) => {
      const has = prev.chatModels.includes(id);
      const nextSelected = has
        ? prev.chatModels.filter((x) => x !== id)
        : [...prev.chatModels, id];
      // Reset default if the previously-default model was removed.
      const nextDefault =
        prev.defaultChatModel && nextSelected.includes(prev.defaultChatModel)
          ? prev.defaultChatModel
          : nextSelected[0] ?? null;
      return { ...prev, chatModels: nextSelected, defaultChatModel: nextDefault };
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      const resp = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        toast.error(err.error ?? "Failed to save settings");
        return;
      }
      toast.success("Model preferences saved");
    } finally {
      setSaving(false);
    }
  };

  const selectedCount = settings.chatModels.length;
  const effectiveDefault =
    settings.defaultChatModel ?? settings.chatModels[0] ?? CHAT_MODEL_ALLOWLIST[0];

  return (
    <section className="rounded-lg border bg-card p-4 space-y-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Sparkles className="size-4" /> Model preferences
          </h2>
          <p className="text-xs text-muted-foreground">
            Pick which chat models show up in your chat picker, and set your defaults for
            embedding + reranking. Sourced from OpenRouter.
          </p>
        </div>
        <Button size="sm" onClick={save} disabled={saving}>
          {saving && <Loader2 className="size-3 animate-spin mr-1.5" />}
          Save
        </Button>
      </header>

      {/* Chat models multi-select */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <Label className="text-xs font-medium">Chat models</Label>
            <p className="text-[11px] text-muted-foreground">
              {selectedCount === 0
                ? "Nothing selected — chat will fall back to the system allowlist."
                : `${selectedCount} model${selectedCount === 1 ? "" : "s"} enabled.`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search models…"
                className="h-7 pl-7 text-xs w-44"
              />
            </div>
            <div className="flex items-center gap-1">
              <Filter className="size-3 text-muted-foreground" />
              <Select
                value={providerFilter}
                onValueChange={(v) => setProviderFilter(v ?? PROVIDER_ANY)}
              >
                <SelectTrigger className="h-7 w-[140px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={PROVIDER_ANY} className="text-xs">
                    All providers
                  </SelectItem>
                  {providers.map((p) => (
                    <SelectItem key={p} value={p} className="text-xs">
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {/* Selected chips */}
        {settings.chatModels.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {settings.chatModels.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => toggleChatModel(id)}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary/15 px-2 py-0.5 text-[11px] text-primary hover:bg-primary/25"
              >
                {id}
                <span className="text-primary/60">×</span>
              </button>
            ))}
          </div>
        )}

        {/* Catalog list */}
        <div className="max-h-[360px] overflow-y-auto rounded-md border">
          {loading && (
            <div className="flex items-center justify-center gap-2 p-6 text-xs text-muted-foreground">
              <Loader2 className="size-3 animate-spin" /> Loading models…
            </div>
          )}
          {!loading && filteredChatModels.length === 0 && (
            <p className="p-4 text-xs text-muted-foreground text-center">
              No models match the current filter.
            </p>
          )}
          <ul className="divide-y">
            {filteredChatModels.map((m) => {
              const selected = settings.chatModels.includes(m.id);
              return (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => toggleChatModel(m.id)}
                    className="flex w-full items-start gap-3 px-3 py-2 text-left hover:bg-secondary/50"
                  >
                    <span
                      className={`mt-0.5 flex size-4 items-center justify-center rounded border ${
                        selected
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-muted-foreground/30"
                      }`}
                    >
                      {selected && <Check className="size-3" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium truncate">{m.name}</span>
                        <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
                          {m.provider}
                        </Badge>
                      </div>
                      <p className="text-[11px] text-muted-foreground truncate">{m.id}</p>
                      {m.contextLength && (
                        <p className="text-[10px] text-muted-foreground">
                          {(m.contextLength / 1000).toLocaleString()}k ctx
                          {m.pricing.prompt
                            ? ` · $${Number(m.pricing.prompt) * 1_000_000}/M in`
                            : ""}
                          {m.pricing.completion
                            ? ` · $${Number(m.pricing.completion) * 1_000_000}/M out`
                            : ""}
                        </p>
                      )}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      {/* Default chat model */}
      <div className="space-y-2">
        <Label className="text-xs font-medium">Default chat model</Label>
        <Select
          value={effectiveDefault}
          onValueChange={(v) =>
            setSettings((prev) => ({ ...prev, defaultChatModel: v || null }))
          }
        >
          <SelectTrigger className="h-8 text-xs w-full max-w-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(settings.chatModels.length > 0
              ? settings.chatModels
              : [...CHAT_MODEL_ALLOWLIST]
            ).map((id) => (
              <SelectItem key={id} value={id} className="text-xs">
                {id}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-[11px] text-muted-foreground">
          Pre-selected in the chat picker when starting a new conversation.
        </p>
      </div>

      {/* Embedding model */}
      <div className="space-y-2">
        <Label className="text-xs font-medium">Embedding model</Label>
        <Select
          value={settings.embeddingModel ?? ""}
          onValueChange={(v) =>
            setSettings((prev) => ({ ...prev, embeddingModel: v || null }))
          }
        >
          <SelectTrigger className="h-8 text-xs w-full max-w-sm">
            <SelectValue placeholder="System default" />
          </SelectTrigger>
          <SelectContent>
            {(catalog?.embeddings ?? []).map((m) => (
              <SelectItem key={m.id} value={m.id} className="text-xs">
                {m.name}{" "}
                <span className="text-muted-foreground">({m.dimensions}d)</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-[11px] text-muted-foreground">
          Used to embed your search queries. The corpus is indexed at 1536 dimensions — picking
          a model with different dimensions will break search. Leave on default unless you know
          what you&apos;re doing.
        </p>
      </div>

      {/* Reranker model */}
      <div className="space-y-2">
        <Label className="text-xs font-medium">Reranker model</Label>
        <Select
          value={settings.rerankerModel ?? ""}
          onValueChange={(v) =>
            setSettings((prev) => ({ ...prev, rerankerModel: v || null }))
          }
        >
          <SelectTrigger className="h-8 text-xs w-full max-w-sm">
            <SelectValue placeholder="System default" />
          </SelectTrigger>
          <SelectContent>
            {(catalog?.rerankers ?? []).map((m) => (
              <SelectItem key={m.id} value={m.id} className="text-xs">
                {m.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-[11px] text-muted-foreground">
          Re-ranks the top hybrid-search candidates before they reach the chat model.
        </p>
      </div>
    </section>
  );
}
