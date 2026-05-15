"use client"

import { Bell } from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"

export function TopBar() {
  return (
    <div className="h-10 border-b border-border flex items-center px-4 shrink-0">
      {/* Left - Empty */}
      <div className="flex-1" />
      
      {/* Center - Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className="size-2 rounded-full bg-indigo-500" />
        <span>IT</span>
      </nav>
      
      {/* Right - Actions */}
      <div className="flex-1 flex items-center justify-end gap-2">
        <button className="p-1.5 hover:bg-secondary rounded-md transition-colors relative">
          <Bell className="size-4 text-muted-foreground" />
          <span className="absolute top-1 right-1 size-1.5 rounded-full bg-primary" />
        </button>
        <Avatar className="size-6">
          <AvatarFallback className="text-[10px] bg-secondary text-foreground">TR</AvatarFallback>
        </Avatar>
      </div>
    </div>
  )
}
