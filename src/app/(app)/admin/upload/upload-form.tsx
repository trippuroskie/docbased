"use client";

import { useState } from "react";
import { CheckCircle2, FileText, Loader2, Paperclip } from "lucide-react";
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
import { toast } from "sonner";

const TIER_1_EXTS = new Set([".md", ".markdown", ".txt", ".zip", ".docx"]);

type UploadResult = {
  documentId: string;
  path: string;
  tier: "indexed" | "metadata_only";
  status: string;
  chunkCount?: number;
  message?: string;
};

export function UploadForm({
  spaces,
}: {
  spaces: Array<{ id: string; name: string }>;
}) {
  const [spaceId, setSpaceId] = useState<string>(spaces[0]?.id ?? "");
  const [files, setFiles] = useState<File[]>([]);
  const [tags, setTags] = useState("");
  const [conflict, setConflict] = useState<"replace" | "skip" | "version">("replace");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<UploadResult[]>([]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!spaceId || files.length === 0) return;
    setBusy(true);
    setResults([]);

    const tagList = tags.split(",").map((t) => t.trim()).filter(Boolean);
    const aggregated: UploadResult[] = [];

    for (const file of files) {
      const fd = new FormData();
      fd.set("file", file);
      fd.set("spaceId", spaceId);
      fd.set("tags", JSON.stringify(tagList));
      fd.set("conflict", conflict);

      const resp = await fetch("/api/admin/upload", { method: "POST", body: fd });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        toast.error(`${file.name}: ${err.error ?? resp.statusText}`);
        continue;
      }
      const data = (await resp.json()) as { results: UploadResult[] };
      aggregated.push(...data.results);
      setResults([...aggregated]);
    }

    setBusy(false);
    const created = aggregated.filter(
      (r) => r.status === "created" || r.status === "replaced",
    ).length;
    toast.success(`${created} documents processed.`);
  };

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div className="space-y-2">
        <Label>Destination space</Label>
        <Select value={spaceId} onValueChange={(v) => v && setSpaceId(v)}>
          <SelectTrigger>
            <SelectValue placeholder="Choose a space" />
          </SelectTrigger>
          <SelectContent>
            {spaces.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label>Files</Label>
        <Input
          type="file"
          multiple
          onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
          accept=".md,.markdown,.txt,.zip,.pdf,.docx,.pptx,.xlsx"
        />
        {files.length > 0 && (
          <ul className="space-y-1 text-xs">
            {files.map((f) => {
              const ext = `.${f.name.split(".").pop()?.toLowerCase()}`;
              const tier1 = TIER_1_EXTS.has(ext);
              return (
                <li key={f.name} className="flex items-center gap-2">
                  {tier1 ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                  ) : (
                    <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                  <span className="truncate">{f.name}</span>
                  <span className="text-muted-foreground">
                    {tier1 ? "indexed" : "metadata only"}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="space-y-2">
        <Label>Tags (comma-separated, applied to every file)</Label>
        <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="runbook, network" />
      </div>

      <div className="space-y-2">
        <Label>On filename conflict</Label>
        <Select
          value={conflict}
          onValueChange={(v) => v && setConflict(v as "replace" | "skip" | "version")}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="replace">Replace existing</SelectItem>
            <SelectItem value="skip">Skip</SelectItem>
            <SelectItem value="version">Add as new version (-v2 suffix)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Button type="submit" disabled={busy || files.length === 0 || !spaceId}>
        {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
        {busy ? "Uploading…" : `Upload ${files.length} file${files.length === 1 ? "" : "s"}`}
      </Button>

      {results.length > 0 && (
        <section className="space-y-1 rounded-lg border p-3 text-sm">
          <h3 className="font-medium">Results</h3>
          <ul className="space-y-0.5 text-xs">
            {results.map((r, i) => (
              <li key={i} className="flex items-center gap-2">
                {r.tier === "indexed" ? (
                  <FileText className="h-3.5 w-3.5" />
                ) : (
                  <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />
                )}
                <span className="truncate">{r.path || "(in zip)"}</span>
                <span className="text-muted-foreground">
                  {r.status}
                  {r.chunkCount ? ` · ${r.chunkCount} chunks` : ""}
                  {r.message ? ` · ${r.message}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </form>
  );
}
