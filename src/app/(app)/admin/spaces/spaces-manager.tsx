"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

type Space = { id: string; slug: string; name: string; description: string | null };

export function SpacesManager({ initial }: { initial: Space[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const resp = await fetch("/api/admin/spaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, slug: slug || slugify(name), description }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        toast.error(err.error ?? "Failed");
        return;
      }
      toast.success(`Created ${name}`);
      setName("");
      setSlug("");
      setDescription("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string, name: string) => {
    if (!confirm(`Delete space "${name}"? This soft-deletes all its documents.`)) return;
    const resp = await fetch(`/api/admin/spaces/${id}`, { method: "DELETE" });
    if (resp.ok) {
      toast.success("Deleted");
      router.refresh();
    } else {
      toast.error("Failed");
    }
  };

  return (
    <div className="space-y-6">
      <form onSubmit={create} className="grid gap-3 rounded-lg border p-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="space-y-2">
          <Label>Slug</Label>
          <Input
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder={slugify(name)}
          />
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label>Description</Label>
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
        </div>
        <div className="sm:col-span-2">
          <Button type="submit" disabled={busy || !name}>
            Create space
          </Button>
        </div>
      </form>

      <ul className="divide-y rounded-lg border">
        {initial.map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-3 p-3">
            <div className="min-w-0">
              <p className="font-medium">{s.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                /{s.slug} · {s.description ?? "—"}
              </p>
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive"
              onClick={() => remove(s.id, s.name)}
            >
              Delete
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
