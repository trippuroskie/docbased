import Link from "next/link";
import { FileText, Paperclip, Folder, Shield, Home } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Badge } from "@/components/ui/badge";
import { getAccessibleSpaces, getCurrentUserRecord } from "@/lib/auth";
import { getSpaceTree, type TreeNode } from "@/lib/tree";

export async function AppSidebar() {
  const me = await getCurrentUserRecord();
  const spaces = await getAccessibleSpaces();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="px-3 py-2">
        <Link href="/" className="text-sm font-semibold">
          docbased
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton render={<Link href="/" />}>
                  <Home className="h-4 w-4" />
                  <span>Home</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              {me?.is_admin && (
                <SidebarMenuItem>
                  <SidebarMenuButton render={<Link href="/admin" />}>
                    <Shield className="h-4 w-4" />
                    <span>Admin</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {spaces.map((s) => (
          <SpaceTreeGroup key={s.id} spaceId={s.id} name={s.name} slug={s.slug} role={s.role} />
        ))}
      </SidebarContent>
    </Sidebar>
  );
}

async function SpaceTreeGroup({
  spaceId,
  name,
  slug,
  role,
}: {
  spaceId: string;
  name: string;
  slug: string;
  role: string;
}) {
  const tree = await getSpaceTree(spaceId);
  return (
    <SidebarGroup>
      <SidebarGroupLabel className="flex items-center justify-between">
        <Link href={`/space/${slug}`} className="hover:underline">
          {name}
        </Link>
        <Badge variant="outline" className="text-[10px]">{role}</Badge>
      </SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>{renderTree(tree)}</SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

function renderTree(nodes: TreeNode[]): React.ReactNode {
  return nodes.map((n) => {
    if (n.type === "folder") {
      return (
        <SidebarMenuItem key={`folder:${n.path}`}>
          <details className="group/folder">
            <summary className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-accent">
              <Folder className="h-4 w-4 text-muted-foreground" />
              <span className="truncate">{n.name}</span>
            </summary>
            <ul className="ml-3 border-l pl-2">{renderTree(n.children)}</ul>
          </details>
        </SidebarMenuItem>
      );
    }
    return (
      <SidebarMenuItem key={n.id}>
        <SidebarMenuButton
          size="sm"
          render={<Link href={`/doc/${n.id}`} className="flex items-center gap-2" />}
        >
          {n.status === "metadata_only" ? (
            <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <FileText className="h-3.5 w-3.5 text-muted-foreground" />
          )}
          <span className="truncate">{n.title}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  });
}
