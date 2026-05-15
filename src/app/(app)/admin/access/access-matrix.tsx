"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";

type User = { id: string; email: string };
type Space = { id: string; name: string };
type Grant = { space_id: string; user_id: string; role: string };

const ROLES = ["none", "viewer", "editor", "owner"] as const;
type Role = (typeof ROLES)[number];

export function AccessMatrix({
  users,
  spaces,
  grants,
}: {
  users: User[];
  spaces: Space[];
  grants: Grant[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [local, setLocal] = useState<Map<string, Role>>(() => {
    const m = new Map<string, Role>();
    for (const g of grants) m.set(key(g.user_id, g.space_id), g.role as Role);
    return m;
  });

  const update = async (userId: string, spaceId: string, role: Role) => {
    const next = new Map(local);
    next.set(key(userId, spaceId), role);
    setLocal(next);

    const resp = await fetch("/api/admin/access", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, spaceId, role: role === "none" ? null : role }),
    });
    if (!resp.ok) {
      toast.error("Failed to update");
      const reverted = new Map(local);
      reverted.delete(key(userId, spaceId));
      setLocal(reverted);
      return;
    }
    startTransition(() => router.refresh());
  };

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>User</TableHead>
          {spaces.map((s) => (
            <TableHead key={s.id}>{s.name}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {users.map((u) => (
          <TableRow key={u.id}>
            <TableCell className="text-xs">{u.email}</TableCell>
            {spaces.map((s) => {
              const role = local.get(key(u.id, s.id)) ?? "none";
              return (
                <TableCell key={s.id}>
                  <Select
                    value={role}
                    onValueChange={(v) => v && update(u.id, s.id, v as Role)}
                    disabled={pending}
                  >
                    <SelectTrigger className="h-7 w-[100px] text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ROLES.map((r) => (
                        <SelectItem key={r} value={r} className="text-xs">
                          {r}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
              );
            })}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function key(userId: string, spaceId: string) {
  return `${userId}:${spaceId}`;
}
