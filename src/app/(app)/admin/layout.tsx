import Link from "next/link";
import { requireAdmin } from "@/lib/auth";

const TABS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/upload", label: "Upload" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/spaces", label: "Spaces" },
  { href: "/admin/access", label: "Access" },
  { href: "/admin/audit", label: "Audit" },
  { href: "/admin/usage", label: "Usage" },
];

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAdmin();
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <nav className="flex gap-1 border-b px-4 py-2 text-sm">
        {TABS.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className="rounded px-3 py-1.5 hover:bg-accent"
          >
            {t.label}
          </Link>
        ))}
      </nav>
      <div className="flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}
