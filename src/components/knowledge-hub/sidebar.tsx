"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Search,
  ChevronRight,
  ChevronDown,
  FileText,
  Paperclip,
  Check,
  Folder,
  Layers,
  PanelLeftClose,
  PanelLeft,
  Upload as UploadIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import type { TreeNode } from "@/lib/tree";
import type { ChatUser, SpaceWithTree } from "./types";

interface SidebarProps {
  spaces: SpaceWithTree[];
  selectedDocId: string | null;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  user: ChatUser;
}

type Expanded = { spaces: Set<string>; folders: Set<string> };

function pathToDoc(
  nodes: TreeNode[],
  docId: string,
  trail: string[] = [],
): string[] | null {
  for (const n of nodes) {
    if (n.type === "doc") {
      if (n.id === docId) return trail;
    } else {
      const found = pathToDoc(n.children, docId, [...trail, n.path]);
      if (found) return found;
    }
  }
  return null;
}

function initialExpansion(
  spaces: SpaceWithTree[],
  selectedDocId: string | null,
): Expanded {
  const sp = new Set<string>();
  const fl = new Set<string>();

  if (selectedDocId) {
    for (const s of spaces) {
      const path = pathToDoc(s.tree, selectedDocId);
      if (path) {
        sp.add(s.id);
        for (const p of path) fl.add(`${s.id}:${p}`);
        return { spaces: sp, folders: fl };
      }
    }
  }
  if (spaces[0]) sp.add(spaces[0].id);
  return { spaces: sp, folders: fl };
}

export function Sidebar({
  spaces,
  selectedDocId,
  isCollapsed,
  onToggleCollapse,
  user,
}: SidebarProps) {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState("");
  const [expanded, setExpanded] = useState<Expanded>(() =>
    initialExpansion(spaces, selectedDocId),
  );

  const toggleSpace = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev.spaces);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { ...prev, spaces: next };
    });
  };

  const toggleFolder = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev.folders);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return { ...prev, folders: next };
    });
  };

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const q = searchQuery.trim();
    if (!q) return;
    router.push(`/search?q=${encodeURIComponent(q)}`);
  };

  const empty = useMemo(() => spaces.length === 0, [spaces]);

  return (
    <div
      className={cn(
        "border-r border-border flex flex-col h-full transition-all duration-200",
        isCollapsed ? "w-[60px]" : "w-[260px]",
      )}
    >
      {/* Logo + Search + Collapse Toggle */}
      <div className={cn("p-4", isCollapsed ? "px-2" : "space-y-4")}>
        <div className="flex items-center justify-between">
          <div
            className={cn(
              "flex items-center gap-2",
              isCollapsed && "justify-center w-full",
            )}
          >
            <div className="size-6 rounded bg-primary/20 flex items-center justify-center shrink-0">
              <Layers className="size-3.5 text-primary" />
            </div>
            {!isCollapsed && (
              <span className="font-semibold text-sm">Knowledge Hub</span>
            )}
          </div>
          {!isCollapsed && (
            <Button
              variant="ghost"
              size="icon"
              className="size-7 shrink-0"
              onClick={onToggleCollapse}
            >
              <PanelLeftClose className="size-4 text-muted-foreground" />
            </Button>
          )}
        </div>

        {isCollapsed ? (
          <>
            <Button
              variant="ghost"
              size="icon"
              className="w-full h-8 mt-3"
              onClick={onToggleCollapse}
            >
              <PanelLeft className="size-4 text-muted-foreground" />
            </Button>
            {user.isAdmin && (
              <Link
                href="/admin/upload"
                title="Upload documents"
                className="mt-1 flex h-8 w-full items-center justify-center rounded-lg hover:bg-muted transition-colors"
              >
                <UploadIcon className="size-4 text-muted-foreground" />
              </Link>
            )}
          </>
        ) : (
          <>
            <form onSubmit={submitSearch} className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                placeholder="Search..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 pr-12 h-8 text-sm bg-secondary/50 border-border"
              />
              <kbd className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border border-border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
                ⌘K
              </kbd>
            </form>
            {user.isAdmin && (
              <Link
                href="/admin/upload"
                className="flex h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-secondary text-sm font-medium text-secondary-foreground hover:bg-secondary/80 transition-colors"
              >
                <UploadIcon className="size-3.5" />
                Upload documents
              </Link>
            )}
          </>
        )}
      </div>

      {/* Tree */}
      <ScrollArea className="flex-1 px-2">
        <div className="space-y-1 pb-4">
          {empty && !isCollapsed && (
            <p className="px-2 py-4 text-xs text-muted-foreground">
              You don&apos;t have access to any spaces yet. Ask an admin to
              grant you access.
            </p>
          )}

          {spaces.map((space) => {
            const isOpen = expanded.spaces.has(space.id);
            return (
              <div key={space.id}>
                <button
                  onClick={() => !isCollapsed && toggleSpace(space.id)}
                  className={cn(
                    "w-full flex items-center gap-2 px-2 py-1.5 text-sm font-medium text-foreground hover:bg-secondary/50 rounded-md transition-colors",
                    isCollapsed && "justify-center px-0",
                  )}
                  title={isCollapsed ? space.name : undefined}
                >
                  {!isCollapsed &&
                    (isOpen ? (
                      <ChevronDown className="size-4 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="size-4 text-muted-foreground" />
                    ))}
                  <span
                    className={cn("size-2 rounded-full shrink-0", space.color)}
                  />
                  {!isCollapsed && <span className="truncate">{space.name}</span>}
                </button>

                {isOpen && !isCollapsed && (
                  <div className="ml-4 border-l border-border/50">
                    {space.tree.length === 0 && (
                      <p className="ml-2 px-2 py-1.5 text-xs text-muted-foreground italic">
                        No documents yet.
                      </p>
                    )}
                    {space.tree.map((node) => (
                      <TreeNodeView
                        key={`${space.id}:${node.type === "doc" ? node.id : node.path}`}
                        node={node}
                        depth={0}
                        spaceId={space.id}
                        expandedFolders={expanded.folders}
                        toggleFolder={toggleFolder}
                        selectedDocId={selectedDocId}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </ScrollArea>

      {/* User Section */}
      <div
        className={cn(
          "border-t border-border p-3 flex items-center",
          isCollapsed ? "justify-center" : "gap-3",
        )}
      >
        <Avatar className="size-7 shrink-0">
          <AvatarFallback className="text-xs bg-secondary text-foreground">
            {user.initials}
          </AvatarFallback>
        </Avatar>
        {!isCollapsed && (
          <span className="text-sm font-medium flex-1 truncate">
            {user.name}
          </span>
        )}
      </div>
    </div>
  );
}

function TreeNodeView({
  node,
  depth,
  spaceId,
  expandedFolders,
  toggleFolder,
  selectedDocId,
}: {
  node: TreeNode;
  depth: number;
  spaceId: string;
  expandedFolders: Set<string>;
  toggleFolder: (key: string) => void;
  selectedDocId: string | null;
}) {
  if (node.type === "doc") {
    const isSelected = selectedDocId === node.id;
    return (
      <Link
        href={`/?doc=${node.id}`}
        scroll={false}
        prefetch={false}
        className={cn(
          "w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-md transition-colors ml-2",
          isSelected
            ? "bg-primary/15 text-primary"
            : "text-muted-foreground hover:text-foreground hover:bg-secondary/50",
        )}
      >
        <FileText className="size-3.5 shrink-0" />
        <span className="truncate text-left flex-1">{node.title}</span>
        {node.status === "indexed" ? (
          <Check className="size-3 ml-auto shrink-0 text-emerald-500" />
        ) : node.status === "metadata_only" ? (
          <Paperclip className="size-3 ml-auto shrink-0" />
        ) : null}
      </Link>
    );
  }

  const key = `${spaceId}:${node.path}`;
  const isOpen = expandedFolders.has(key);
  return (
    <div>
      <button
        onClick={() => toggleFolder(key)}
        className="w-full flex items-center gap-2 px-2 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-secondary/50 rounded-md transition-colors ml-2"
      >
        {isOpen ? (
          <ChevronDown className="size-3.5" />
        ) : (
          <ChevronRight className="size-3.5" />
        )}
        <Folder className="size-3.5" />
        <span className="truncate">{node.name}</span>
      </button>
      {isOpen && (
        <div className="ml-6 border-l border-border/50">
          {node.children.map((child) => (
            <TreeNodeView
              key={`${spaceId}:${child.type === "doc" ? child.id : child.path}`}
              node={child}
              depth={depth + 1}
              spaceId={spaceId}
              expandedFolders={expandedFolders}
              toggleFolder={toggleFolder}
              selectedDocId={selectedDocId}
            />
          ))}
        </div>
      )}
    </div>
  );
}
