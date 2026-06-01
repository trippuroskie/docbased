"use client";

import Link from "next/link";
import { Bell, Settings } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import type { ChatUser, SpaceWithTree } from "./types";

export function TopBar({
  user,
  space,
}: {
  user: ChatUser;
  space: SpaceWithTree | null;
}) {
  return (
    <div className="h-10 border-b border-border flex items-center px-4 shrink-0">
      <div className="flex-1" />

      <nav className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {space ? (
          <>
            <span className={cn("size-2 rounded-full", space.color)} />
            <span className="truncate max-w-[200px]">{space.name}</span>
          </>
        ) : (
          <span className="opacity-50">No space</span>
        )}
      </nav>

      <div className="flex-1 flex items-center justify-end gap-2">
        <button
          className="p-1.5 hover:bg-secondary rounded-md transition-colors relative"
          aria-label="Notifications"
        >
          <Bell className="size-4 text-muted-foreground" />
        </button>
        {user.isAdmin && (
          <Link
            href="/admin"
            title="Settings"
            className="p-1.5 hover:bg-secondary rounded-md transition-colors"
          >
            <Settings className="size-4 text-muted-foreground" />
          </Link>
        )}
        <Avatar className="size-6">
          <AvatarFallback className="text-[10px] bg-secondary text-foreground">
            {user.initials}
          </AvatarFallback>
        </Avatar>
      </div>
    </div>
  );
}
