import { requireAdmin } from "@/lib/auth";
import { AdminNav } from "./admin-nav";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAdmin();
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <AdminNav />
      <div className="flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}
