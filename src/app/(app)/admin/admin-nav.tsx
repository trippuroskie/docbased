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
    <nav className="flex flex-wrap items-center gap-1 border-b px-4 py-2 text-sm">
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 rounded px-2 py-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        title="Back to Knowledge Hub"
      >
        <ArrowLeft className="size-4" />
        <span>Knowledge Hub</span>
      </Link>
      <div className="mx-1 h-5 w-px bg-border" />
      <span className="inline-flex items-center gap-1.5 px-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        <Shield className="size-3.5" />
        Admin
      </span>
      <div className="ml-1 flex flex-wrap gap-1">
        {TABS.map((t) => {
          const active =
            t.href === "/admin"
              ? pathname === "/admin"
              : pathname === t.href || pathname.startsWith(t.href + "/");
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "rounded px-3 py-1.5 transition-colors",
                active
                  ? "bg-accent font-medium text-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {t.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
