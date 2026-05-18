import { requireAdmin } from "@/lib/auth";
import { AdminNav } from "./admin-nav";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAdmin();
  // The parent (app) layout provides a flex-row with the persistent sidebar
  // on the left and a flex-col main area on the right. Inside that main area
  // we stack AdminNav on top of a scrollable content region.
  return (
    <div className="flex h-full min-h-0 flex-col">
      <AdminNav />
      <div className="flex-1 min-h-0 overflow-y-auto">{children}</div>
    </div>
  );
}
