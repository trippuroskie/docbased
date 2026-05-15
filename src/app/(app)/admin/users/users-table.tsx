"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";

type Row = {
  id: string;
  email: string;
  displayName: string | null;
  isAdmin: boolean;
  createdAt: string | null;
  lastSignInAt: string | null;
};

export function UsersTable({ users }: { users: Row[] }) {
  const router = useRouter();

  const toggleAdmin = async (id: string, next: boolean) => {
    const resp = await fetch(`/api/admin/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isAdmin: next }),
    });
    if (resp.ok) {
      toast.success(next ? "Promoted to admin" : "Demoted to user");
      router.refresh();
    } else {
      toast.error("Failed to update");
    }
  };

  const deactivate = async (id: string) => {
    if (!confirm("Deactivate this user? They will lose access immediately.")) return;
    const resp = await fetch(`/api/admin/users/${id}`, { method: "DELETE" });
    if (resp.ok) {
      toast.success("User deactivated");
      router.refresh();
    } else {
      toast.error("Failed to deactivate");
    }
  };

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Email</TableHead>
          <TableHead>Name</TableHead>
          <TableHead>Last sign-in</TableHead>
          <TableHead>Admin</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {users.map((u) => (
          <TableRow key={u.id}>
            <TableCell>{u.email}</TableCell>
            <TableCell>{u.displayName ?? "—"}</TableCell>
            <TableCell className="text-xs text-muted-foreground">
              {u.lastSignInAt ? new Date(u.lastSignInAt).toLocaleDateString() : "Never"}
            </TableCell>
            <TableCell>
              {u.isAdmin ? <Badge>admin</Badge> : <span className="text-muted-foreground">—</span>}
            </TableCell>
            <TableCell className="space-x-1 text-right">
              <Button
                size="sm"
                variant="outline"
                onClick={() => toggleAdmin(u.id, !u.isAdmin)}
              >
                {u.isAdmin ? "Revoke admin" : "Make admin"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive"
                onClick={() => deactivate(u.id)}
              >
                Deactivate
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
