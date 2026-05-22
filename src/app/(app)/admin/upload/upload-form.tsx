"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, FileText, ImageIcon, Loader2, Paperclip } from "lucide-react";
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
const IMAGE_EXTS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".svg",
  ".tiff",
  ".tif",
  ".avif",
]);
const ASSET_HOST_EXTS = new Set([".md", ".markdown"]);

type UploadResult = {
  documentId: string;
  path: string;
  tier: "indexed" | "metadata_only";
  status: string;
  chunkCount?: number;
  message?: string;
};

type UploadGroup = {
  primary: File;
  assets: File[];
};

type SpaceWithFolders = { id: string; name: string; folders: string[] };

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i === -1 ? "" : name.slice(i).toLowerCase();
}

function classifyFile(name: string): "primary" | "image" | "other" {
  const ext = extOf(name);
  if (TIER_1_EXTS.has(ext)) return "primary";
  if (IMAGE_EXTS.has(ext)) return "image";
  return "other";
}

/**
 * Group selected files into upload requests.
 *
 * If the selection contains at least one markdown file alongside image files,
 * the images are attached to the FIRST markdown file as `_assets/...`. Every
 * other primary file (other markdown files, .docx, .txt, .zip) is uploaded as
 * its own request — same as before.
 *
 * Stray images with no markdown host fall through as `metadata_only` uploads,
 * which preserves the previous behavior.
 */
function planUpload(files: File[]): UploadGroup[] {
  if (files.length === 0) return [];

  const markdownHost = files.find(
    (f) => ASSET_HOST_EXTS.has(extOf(f.name)),
  );
  const images = files.filter((f) => classifyFile(f.name) === "image");

  if (markdownHost && images.length > 0) {
    const groups: UploadGroup[] = [{ primary: markdownHost, assets: images }];
    for (const f of files) {
      if (f === markdownHost) continue;
      if (classifyFile(f.name) === "image") continue; // already attached
      groups.push({ primary: f, assets: [] });
    }
    return groups;
  }

  return files.map((f) => ({ primary: f, assets: [] as File[] }));
}

export function UploadForm({
  spaces,
}: {
  spaces: SpaceWithFolders[];
}) {
  const [spaceId, setSpaceId] = useState<string>(spaces[0]?.id ?? "");
  const [files, setFiles] = useState<File[]>([]);
  const [tags, setTags] = useState("");
  const [conflict, setConflict] = useState<"replace" | "skip" | "version">("replace");
  const [targetFolder, setTargetFolder] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<UploadResult[]>([]);

  const folderSuggestions =
    spaces.find((s) => s.id === spaceId)?.folders ?? [];

  const groups = useMemo(() => planUpload(files), [files]);
  const bundledHost = groups.find((g) => g.assets.length > 0)?.primary.name;
  const totalAssets = groups.reduce((acc, g) => acc + g.assets.length, 0);

  // Reset the folder field when the destination space changes — folders from
  // a different space wouldn't apply.
  const onSpaceChange = (v: string) => {
    setSpaceId(v);
    setTargetFolder("");
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!spaceId || files.length === 0) return;
    setBusy(true);
    setResults([]);

    const tagList = tags.split(",").map((t) => t.trim()).filter(Boolean);
    const aggregated: UploadResult[] = [];

    for (const group of groups) {
      const fd = new FormData();
      fd.set("file", group.primary);
      fd.set("spaceId", spaceId);
      fd.set("tags", JSON.stringify(tagList));
      fd.set("conflict", conflict);
      fd.set("targetFolder", targetFolder.trim());
      for (const a of group.assets) fd.append("assets", a);

      const resp = await fetch("/api/admin/upload", { method: "POST", body: fd });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        toast.error(`${group.primary.name}: ${err.error ?? resp.statusText}`);
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
        <Select value={spaceId} onValueChange={(v) => v && onSpaceChange(v)}>
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
        <Label htmlFor="targetFolder">
          Target folder <span className="text-muted-foreground">(optional)</span>
        </Label>
        <Input
          id="targetFolder"
          list="upload-folder-suggestions"
          value={targetFolder}
          onChange={(e) => setTargetFolder(e.target.value)}
          placeholder="Leave empty for workspace root, or e.g. Notes/Meetings"
        />
        <datalist id="upload-folder-suggestions">
          {folderSuggestions.map((f) => (
            <option key={f} value={f} />
          ))}
        </datalist>
        <p className="text-xs text-muted-foreground">
          Files (and any folder structure inside an uploaded zip) are placed
          under this path.
        </p>
      </div>

      <div className="space-y-2">
        <Label>Files</Label>
        <Input
          type="file"
          multiple
          onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
          accept=".md,.markdown,.txt,.zip,.pdf,.docx,.pptx,.xlsx,.png,.jpg,.jpeg,.gif,.webp,.bmp,.svg,.tiff,.tif,.avif"
        />
        {files.length > 0 && (
          <ul className="space-y-1 text-xs">
            {files.map((f) => {
              const kind = classifyFile(f.name);
              const ext = extOf(f.name);
              const tier1 = TIER_1_EXTS.has(ext);
              const isAttached = kind === "image" && bundledHost;
              return (
                <li key={f.name} className="flex items-center gap-2">
                  {kind === "image" ? (
                    <ImageIcon className="h-3.5 w-3.5 text-muted-foreground" />
                  ) : tier1 ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                  ) : (
                    <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                  <span className="truncate">{f.name}</span>
                  <span className="text-muted-foreground">
                    {isAttached
                      ? `asset → ${bundledHost}`
                      : tier1
                      ? "indexed"
                      : kind === "image"
                      ? "image (no markdown to attach to)"
                      : "metadata only"}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {bundledHost && (
          <p className="text-xs text-muted-foreground">
            Images will be uploaded as assets of <span className="font-mono">{bundledHost}</span> and
            inline <span className="font-mono">![…](filename.png)</span> references
            in the markdown will resolve to them.
          </p>
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
        {busy
          ? "Uploading…"
          : `Upload ${groups.length} document${groups.length === 1 ? "" : "s"}${
              totalAssets ? ` (+${totalAssets} asset${totalAssets === 1 ? "" : "s"})` : ""
            }`}
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
