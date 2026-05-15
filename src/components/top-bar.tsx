"use client";

import { Search, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

export function TopBar({ email }: { email?: string }) {
  const router = useRouter();

  const openPalette = () => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "k", metaKey: true }),
    );
  };

  const signOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  };

  return (
    <div className="flex h-12 items-center justify-between gap-3 border-b px-3">
      <div className="flex items-center gap-2">
        <SidebarTrigger />
      </div>
      <Button
        variant="outline"
        size="sm"
        className="w-full max-w-md justify-between gap-2 text-muted-foreground"
        onClick={openPalette}
      >
        <span className="flex items-center gap-2">
          <Search className="h-4 w-4" /> Search the hub…
        </span>
        <kbd className="rounded border bg-muted px-1.5 py-0.5 text-[10px]">⌘K</kbd>
      </Button>
      <div className="flex items-center gap-2">
        {email && <span className="hidden text-xs text-muted-foreground md:inline">{email}</span>}
        <Button variant="ghost" size="icon" onClick={signOut} title="Sign out">
          <LogOut className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
