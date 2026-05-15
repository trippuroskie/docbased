"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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

export function InviteForm({ spaces }: { spaces: Array<{ id: string; name: string }> }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [spaceId, setSpaceId] = useState<string | undefined>(undefined);
  const [role, setRole] = useState<"viewer" | "editor" | "owner">("viewer");
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const resp = await fetch("/api/admin/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, displayName, spaceId, role }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        toast.error(err.error ?? "Invite failed");
        return;
      }
      toast.success(`Invited ${email}`);
      setEmail("");
      setDisplayName("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="grid gap-3 rounded-lg border p-4 sm:grid-cols-2">
      <div className="space-y-2 sm:col-span-2">
        <Label>Email</Label>
        <Input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="new.user@company.com"
        />
      </div>
      <div className="space-y-2">
        <Label>Display name (optional)</Label>
        <Input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label>Assign to space (optional)</Label>
        <Select value={spaceId} onValueChange={(v) => setSpaceId(v ?? undefined)}>
          <SelectTrigger>
            <SelectValue placeholder="No space" />
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
        <Label>Role</Label>
        <Select
          value={role}
          onValueChange={(v) => v && setRole(v as "viewer" | "editor" | "owner")}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="viewer">Viewer</SelectItem>
            <SelectItem value="editor">Editor</SelectItem>
            <SelectItem value="owner">Owner</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="sm:col-span-2">
        <Button type="submit" disabled={busy}>
          {busy ? "Inviting…" : "Send invite"}
        </Button>
      </div>
    </form>
  );
}
