"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, Shield } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/upload", label: "Upload" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/spaces", label: "Spaces" },
  { href: "/admin/access", label: "Access" },
  { href: "/admin/audit", label: "Audit" },
  { href: "/admin/usage", label: "Usage" },
];

export function AdminNav() {
  const pathname = usePathname();
  return (
    <div className="flex flex-wrap items-center gap-2 border-b px-4 pt-2 text-sm">
      <Link
        href="/"
        className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        title="Back to docbased"
      >
        <ArrowLeft className="size-4" />
        <span>docbased</span>
      </Link>
      <div className="h-5 w-px bg-border" />
      <span className="inline-flex h-8 items-center gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        <Shield className="size-3.5" />
        Admin
      </span>
      <nav
        role="tablist"
        aria-label="Admin sections"
        className="ml-1 flex flex-wrap items-center gap-1"
      >
        {TABS.map((t) => {
          const active =
            t.href === "/admin"
              ? pathname === "/admin"
              : pathname === t.href || pathname.startsWith(t.href + "/");
          return (
            <Link
              key={t.href}
              href={t.href}
              role="tab"
              aria-selected={active}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative inline-flex h-8 items-center rounded-md px-3 text-sm font-medium transition-colors",
                active
                  ? "text-foreground after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:bg-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
