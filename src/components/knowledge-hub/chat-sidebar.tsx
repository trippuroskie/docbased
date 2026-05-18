"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Search,
  ChevronRight,
  ChevronDown,
  FileText,
  Folder,
  Paperclip,
  Check,
  Layers,
  PanelLeftClose,
  PanelLeft,
  SquarePen,
  Trash2,
  MessageSquare,
  FileSearch,
  Upload as UploadIcon,
  Settings,
  SquareArrowOutUpRight,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import type { TreeNode } from "@/lib/tree";
import type { SpaceWithTree } from "./types";

export type ChatSummary = {
  id: string;
  title: string | null;
  created_at: string;
};

interface ChatSidebarProps {
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  conversations: ChatSummary[];
  conversationsLoading: boolean;
  currentConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onDeleteConversation: (id: string) => void;
  onNewChat: () => void;
  spaces: SpaceWithTree[];
  onSelectDoc: (docId: string) => void;
  onOpenDocInNewTab: (docId: string) => void;
  isAdmin: boolean;
  userDisplayName?: string | null;
  userEmail?: string | null;
}

function initialsFor(name: string | null | undefined, email: string | null | undefined): string {
  const source = (name && name.trim()) || (email && email.split("@")[0]) || "";
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function formatGroup(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffDays = Math.floor(
    (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24),
  );
  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return "Last 7 days";
  if (diffDays < 30) return "Last 30 days";
  return "Earlier";
}

function pathToDoc(nodes: TreeNode[], docId: string, trail: string[] = []): string[] | null {
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

type DocDragPayload = {
  docId: string;
  spaceId: string;
  currentPath: string;
};

type PendingDelete =
  | { kind: "doc"; docId: string; title: string }
  | { kind: "folder"; spaceId: string; folderPath: string };

export function ChatSidebar({
  isCollapsed,
  onToggleCollapse,
  conversations,
  conversationsLoading,
  currentConversationId,
  onSelectConversation,
  onDeleteConversation,
  onNewChat,
  spaces,
  onSelectDoc,
  onOpenDocInNewTab,
  isAdmin,
  userDisplayName,
  userEmail,
}: ChatSidebarProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = React.useState<string>("docs");
  const [chatSearch, setChatSearch] = React.useState("");
  const [docSearch, setDocSearch] = React.useState("");
  const [expandedSpaces, setExpandedSpaces] = React.useState<Set<string>>(
    () => new Set(spaces.length > 0 ? [spaces[0].id] : []),
  );
  const [expandedFolders, setExpandedFolders] = React.useState<Set<string>>(
    new Set(),
  );
  // Tracks the doc currently being dragged. Used by drop targets to decide
  // whether to show a "valid drop" indicator (only same-space drops are
  // allowed in v1; cross-space moves would require a different endpoint).
  const [drag, setDrag] = React.useState<DocDragPayload | null>(null);
  const [pendingDelete, setPendingDelete] =
    React.useState<PendingDelete | null>(null);
  const [deleting, setDeleting] = React.useState(false);

  const deleteDoc = React.useCallback(
    async (docId: string, title: string) => {
      const resp = await fetch(`/api/documents/${docId}`, { method: "DELETE" });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        toast.error(`Delete failed: ${err.error ?? resp.statusText}`);
        return false;
      }
      toast.success(`Deleted "${title}".`);
      return true;
    },
    [],
  );

  const deleteFolder = React.useCallback(
    async (spaceId: string, folderPath: string) => {
      const resp = await fetch(`/api/spaces/${spaceId}/folders/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folderPath }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        toast.error(`Delete failed: ${err.error ?? resp.statusText}`);
        return false;
      }
      const data = (await resp.json()) as { count: number };
      toast.success(
        data.count === 0
          ? `Folder "${folderPath}" was already empty.`
          : `Deleted ${data.count} document${data.count === 1 ? "" : "s"} from "${folderPath}".`,
      );
      return true;
    },
    [],
  );

  const confirmDelete = React.useCallback(async () => {
    if (!pendingDelete || deleting) return;
    setDeleting(true);
    let ok = false;
    if (pendingDelete.kind === "doc") {
      ok = await deleteDoc(pendingDelete.docId, pendingDelete.title);
    } else {
      ok = await deleteFolder(pendingDelete.spaceId, pendingDelete.folderPath);
    }
    setDeleting(false);
    if (ok) {
      setPendingDelete(null);
      router.refresh();
    }
  }, [pendingDelete, deleting, deleteDoc, deleteFolder, router]);

  const moveDoc = React.useCallback(
    async (payload: DocDragPayload, targetFolder: string) => {
      const filename =
        payload.currentPath.split("/").filter(Boolean).pop() ?? "";
      if (!filename) return;
      const newPath = targetFolder ? `${targetFolder}/${filename}` : filename;
      if (newPath === payload.currentPath) return;

      const resp = await fetch(`/api/documents/${payload.docId}/move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPath }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        if (err.error === "path_conflict") {
          toast.error(
            "A document with that name already exists in the target folder.",
          );
        } else if (err.error === "invalid_path") {
          toast.error("That destination isn't a valid folder path.");
        } else {
          toast.error(`Move failed: ${err.error ?? resp.statusText}`);
        }
        return;
      }
      toast.success(`Moved to ${targetFolder || "workspace root"}.`);
      router.refresh();
    },
    [router],
  );

  const toggleSpace = (id: string) => {
    setExpandedSpaces((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleFolder = (key: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const filteredConversations = React.useMemo(() => {
    if (!chatSearch.trim()) return conversations;
    const q = chatSearch.toLowerCase();
    return conversations.filter((c) =>
      (c.title ?? "").toLowerCase().includes(q),
    );
  }, [conversations, chatSearch]);

  // Group conversations by recency bucket, preserving order.
  const groupedConversations = React.useMemo(() => {
    const groups: { label: string; items: ChatSummary[] }[] = [];
    let currentLabel = "";
    for (const c of filteredConversations) {
      const label = formatGroup(c.created_at);
      if (label !== currentLabel) {
        groups.push({ label, items: [] });
        currentLabel = label;
      }
      groups[groups.length - 1].items.push(c);
    }
    return groups;
  }, [filteredConversations]);

  // Filter spaces tree by doc title.
  const filteredSpaces = React.useMemo(() => {
    if (!docSearch.trim()) return spaces;
    const q = docSearch.toLowerCase();
    return spaces
      .map((s) => ({ ...s, tree: filterTree(s.tree, q) }))
      .filter((s) => s.tree.length > 0);
  }, [spaces, docSearch]);

  if (isCollapsed) {
    return (
      <aside className="w-12 border-r border-border flex flex-col items-center py-3 gap-1 shrink-0">
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={onToggleCollapse}
          title="Expand sidebar"
        >
          <PanelLeft className="size-4 text-muted-foreground" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={onNewChat}
          title="New chat"
        >
          <SquarePen className="size-4 text-muted-foreground" />
        </Button>
        <div className="h-px w-6 bg-border my-1" />
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={() => {
            onToggleCollapse();
            setActiveTab("docs");
          }}
          title="Documents"
        >
          <FileSearch className="size-4 text-muted-foreground" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={() => {
            onToggleCollapse();
            setActiveTab("chats");
          }}
          title="Chat history"
        >
          <MessageSquare className="size-4 text-muted-foreground" />
        </Button>
        {isAdmin && (
          <Link
            href="/admin/upload"
            title="Upload documents"
            className="flex items-center justify-center size-8 rounded-lg hover:bg-secondary transition-colors"
          >
            <UploadIcon className="size-4 text-muted-foreground" />
          </Link>
        )}
        <div className="mt-auto">
          <Link
            href="/settings"
            title={
              userDisplayName || userEmail
                ? `Settings · ${userDisplayName ?? userEmail}`
                : "Settings"
            }
            className="flex items-center justify-center size-8 rounded-lg hover:bg-secondary transition-colors"
          >
            <Settings className="size-4 text-muted-foreground" />
          </Link>
        </div>
      </aside>
    );
  }

  return (
    <>
    <aside className="w-[280px] border-r border-border flex flex-col shrink-0 h-full min-h-0">
      {/* Header */}
      <div className="p-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <div className="size-6 rounded bg-primary/20 flex items-center justify-center shrink-0">
            <Layers className="size-3.5 text-primary" />
          </div>
          <span className="font-semibold text-sm">Knowledge Hub</span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={onToggleCollapse}
          title="Collapse sidebar"
        >
          <PanelLeftClose className="size-4 text-muted-foreground" />
        </Button>
      </div>

      <div className="px-3 pb-3 shrink-0">
        <Button
          onClick={onNewChat}
          className="w-full h-8 gap-1.5 justify-center bg-secondary text-secondary-foreground hover:bg-secondary/80"
        >
          <SquarePen className="size-3.5" />
          New chat
        </Button>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(v) => v && setActiveTab(v as string)}
        className="flex-1 min-h-0 px-3 pb-3 gap-3 flex flex-col"
      >
        <TabsList className="w-full bg-secondary/40">
          <TabsTrigger value="docs" className="flex-1 text-xs gap-1.5">
            <FileSearch className="size-3" />
            Docs
          </TabsTrigger>
          <TabsTrigger value="chats" className="flex-1 text-xs gap-1.5">
            <MessageSquare className="size-3" />
            Chats
          </TabsTrigger>
        </TabsList>

        <TabsContent
          value="chats"
          className="flex-1 min-h-0 flex flex-col gap-2 mt-0 data-[state=inactive]:hidden"
        >
          <div className="relative shrink-0">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <Input
              placeholder="Search chats…"
              value={chatSearch}
              onChange={(e) => setChatSearch(e.target.value)}
              className="pl-8 h-8 text-xs bg-secondary/40"
            />
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar -mx-1 px-1">
            {conversationsLoading && conversations.length === 0 && (
              <p className="text-xs text-muted-foreground px-2 py-2">
                Loading…
              </p>
            )}
            {!conversationsLoading && groupedConversations.length === 0 && (
              <p className="text-xs text-muted-foreground px-2 py-2">
                {chatSearch.trim()
                  ? "No matches."
                  : "No conversations yet. Start a new chat."}
              </p>
            )}
            {groupedConversations.map((g) => (
              <div key={g.label} className="mb-3">
                <p className="px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                  {g.label}
                </p>
                <div className="space-y-0.5">
                  {g.items.map((c) => (
                    <ConversationRow
                      key={c.id}
                      conversation={c}
                      active={c.id === currentConversationId}
                      onSelect={() => onSelectConversation(c.id)}
                      onDelete={() => onDeleteConversation(c.id)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </TabsContent>

        <TabsContent
          value="docs"
          className="flex-1 min-h-0 flex flex-col gap-2 mt-0 data-[state=inactive]:hidden"
        >
          {isAdmin && (
            <Link
              href="/admin/upload"
              className="flex h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-secondary text-xs font-medium text-secondary-foreground hover:bg-secondary/80 transition-colors shrink-0"
            >
              <UploadIcon className="size-3.5" />
              Upload documents
            </Link>
          )}
          <div className="relative shrink-0">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <Input
              placeholder="Filter docs…"
              value={docSearch}
              onChange={(e) => setDocSearch(e.target.value)}
              className="pl-8 h-8 text-xs bg-secondary/40"
            />
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar -mx-1 px-1">
            {filteredSpaces.length === 0 && (
              <p className="text-xs text-muted-foreground px-2 py-2">
                {docSearch.trim()
                  ? "No matches."
                  : "No accessible workspaces."}
              </p>
            )}
            {filteredSpaces.map((space) => {
              const open =
                expandedSpaces.has(space.id) || docSearch.trim().length > 0;
              const isDropTarget = drag !== null && drag.spaceId === space.id;
              return (
                <div key={space.id} className="mb-2">
                  <SpaceHeaderRow
                    space={space}
                    open={open}
                    onToggle={() =>
                      !docSearch.trim() && toggleSpace(space.id)
                    }
                    canAcceptDrop={isDropTarget}
                    onDropDoc={() => {
                      if (drag && drag.spaceId === space.id) {
                        void moveDoc(drag, "");
                      }
                      setDrag(null);
                    }}
                  />
                  {open && (
                    <div className="ml-4 border-l border-border/50">
                      {space.tree.length === 0 && (
                        <p className="ml-2 px-2 py-1 text-xs text-muted-foreground italic">
                          Empty.
                        </p>
                      )}
                      {space.tree.map((node) => (
                        <DocTreeNode
                          key={`${space.id}:${node.type === "doc" ? node.id : node.path}`}
                          node={node}
                          spaceId={space.id}
                          expandedFolders={expandedFolders}
                          toggleFolder={toggleFolder}
                          forceOpen={docSearch.trim().length > 0}
                          onSelectDoc={onSelectDoc}
                          onOpenDocInNewTab={onOpenDocInNewTab}
                          drag={drag}
                          setDrag={setDrag}
                          onDropOnFolder={(folderPath) => {
                            if (drag && drag.spaceId === space.id) {
                              void moveDoc(drag, folderPath);
                            }
                            setDrag(null);
                          }}
                          onRequestDeleteDoc={(docId, title) =>
                            setPendingDelete({ kind: "doc", docId, title })
                          }
                          onRequestDeleteFolder={(folderPath) =>
                            setPendingDelete({
                              kind: "folder",
                              spaceId: space.id,
                              folderPath,
                            })
                          }
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </TabsContent>
      </Tabs>

      <div className="border-t border-border p-2 shrink-0">
        <Link
          href="/settings"
          className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-secondary/50 transition-colors"
          title="Account settings"
        >
          <span className="size-7 rounded-full bg-secondary text-[10px] font-semibold text-secondary-foreground flex items-center justify-center shrink-0">
            {initialsFor(userDisplayName, userEmail)}
          </span>
          <div className="min-w-0 flex-1 leading-tight">
            <p className="text-xs font-medium truncate">
              {userDisplayName ?? userEmail ?? "Account"}
            </p>
            {userDisplayName && userEmail && (
              <p className="text-[10px] text-muted-foreground truncate">
                {userEmail}
              </p>
            )}
          </div>
          <Settings className="size-3.5 text-muted-foreground shrink-0" />
        </Link>
      </div>
    </aside>
    <AlertDialog
      open={pendingDelete !== null}
      onOpenChange={(open) => {
        if (!open && !deleting) setPendingDelete(null);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {pendingDelete?.kind === "folder"
              ? "Delete folder?"
              : "Delete document?"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {pendingDelete?.kind === "folder"
              ? `Every document under "${pendingDelete.folderPath}" will be removed from the workspace. This cannot be undone from the UI.`
              : pendingDelete?.kind === "doc"
                ? `"${pendingDelete.title}" will be removed from the workspace. This cannot be undone from the UI.`
                : ""}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={deleting}
            onClick={(e) => {
              e.preventDefault();
              void confirmDelete();
            }}
          >
            {deleting ? "Deleting…" : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}

function ConversationRow({
  conversation,
  active,
  onSelect,
  onDelete,
}: {
  conversation: ChatSummary;
  active: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={cn(
        "group flex items-center gap-1 rounded-md transition-colors",
        active ? "bg-primary/15" : "hover:bg-secondary/50",
      )}
    >
      <button
        onClick={onSelect}
        className={cn(
          "flex-1 min-w-0 text-left px-2 py-1.5 text-xs",
          active ? "text-primary font-medium" : "text-muted-foreground",
        )}
      >
        <span className="block truncate">
          {conversation.title ?? "(untitled)"}
        </span>
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        className="opacity-0 group-hover:opacity-100 p-1 mr-1 rounded hover:bg-destructive/20 hover:text-destructive transition-opacity"
        title="Delete conversation"
      >
        <Trash2 className="size-3" />
      </button>
    </div>
  );
}

function SpaceHeaderRow({
  space,
  open,
  onToggle,
  canAcceptDrop,
  onDropDoc,
}: {
  space: SpaceWithTree;
  open: boolean;
  onToggle: () => void;
  canAcceptDrop: boolean;
  onDropDoc: () => void;
}) {
  const [over, setOver] = React.useState(false);
  return (
    <button
      onClick={onToggle}
      onDragOver={(e) => {
        if (!canAcceptDrop) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (!over) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        if (!canAcceptDrop) return;
        e.preventDefault();
        setOver(false);
        onDropDoc();
      }}
      className={cn(
        "w-full flex items-center gap-2 px-2 py-1.5 text-sm font-medium hover:bg-secondary/50 rounded-md transition-colors",
        over && "ring-1 ring-primary bg-primary/10",
      )}
    >
      {open ? (
        <ChevronDown className="size-3.5 text-muted-foreground" />
      ) : (
        <ChevronRight className="size-3.5 text-muted-foreground" />
      )}
      <span className={cn("size-2 rounded-full shrink-0", space.color)} />
      <span className="truncate flex-1 text-left">{space.name}</span>
    </button>
  );
}

type DocTreeNodeProps = {
  node: TreeNode;
  spaceId: string;
  expandedFolders: Set<string>;
  toggleFolder: (key: string) => void;
  forceOpen: boolean;
  onSelectDoc: (docId: string) => void;
  onOpenDocInNewTab: (docId: string) => void;
  drag: DocDragPayload | null;
  setDrag: (d: DocDragPayload | null) => void;
  onDropOnFolder: (folderPath: string) => void;
  onRequestDeleteDoc: (docId: string, title: string) => void;
  onRequestDeleteFolder: (folderPath: string) => void;
};

function DocTreeNode({
  node,
  spaceId,
  expandedFolders,
  toggleFolder,
  forceOpen,
  onSelectDoc,
  onOpenDocInNewTab,
  drag,
  setDrag,
  onDropOnFolder,
  onRequestDeleteDoc,
  onRequestDeleteFolder,
}: DocTreeNodeProps) {
  if (node.type === "doc") {
    const isDragging = drag?.docId === node.id;
    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <button
            draggable
            onDragStart={(e) => {
              setDrag({ docId: node.id, spaceId, currentPath: node.path });
              e.dataTransfer.effectAllowed = "move";
              // Setting any data keeps Firefox happy.
              e.dataTransfer.setData("text/plain", node.id);
            }}
            onDragEnd={() => setDrag(null)}
            onClick={() => onSelectDoc(node.id)}
            onDoubleClick={() => onOpenDocInNewTab(node.id)}
            title="Click to preview · Double-click to open in a new tab · Drag onto a folder to move · Right-click for more"
            className={cn(
              "w-full flex items-center gap-2 px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary/50 rounded-md transition-colors ml-2",
              isDragging && "opacity-50",
            )}
          >
            <FileText className="size-3 shrink-0" />
            <span className="truncate text-left flex-1">{node.title}</span>
            {node.status === "indexed" ? (
              <Check className="size-3 ml-auto shrink-0 text-emerald-500" />
            ) : node.status === "metadata_only" ? (
              <Paperclip className="size-3 ml-auto shrink-0" />
            ) : null}
          </button>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onClick={() => onOpenDocInNewTab(node.id)}>
            <SquareArrowOutUpRight />
            Open in new tab
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            variant="destructive"
            onClick={() => onRequestDeleteDoc(node.id, node.title)}
          >
            <Trash2 />
            Delete
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    );
  }

  const key = `${spaceId}:${node.path}`;
  const open = forceOpen || expandedFolders.has(key);
  // A folder can accept a drop only when the dragged doc lives in the same
  // space and isn't already in this exact folder.
  const canAcceptDrop = (() => {
    if (!drag) return false;
    if (drag.spaceId !== spaceId) return false;
    const currentFolder = drag.currentPath
      .split("/")
      .slice(0, -1)
      .join("/");
    return currentFolder !== node.path;
  })();
  return (
    <FolderRow
      node={node}
      open={open}
      onToggle={() => !forceOpen && toggleFolder(key)}
      canAcceptDrop={canAcceptDrop}
      onDropDoc={() => onDropOnFolder(node.path)}
      onRequestDelete={() => onRequestDeleteFolder(node.path)}
    >
      {open && (
        <div className="ml-4 border-l border-border/50">
          {node.children.map((child) => (
            <DocTreeNode
              key={`${spaceId}:${child.type === "doc" ? child.id : child.path}`}
              node={child}
              spaceId={spaceId}
              expandedFolders={expandedFolders}
              toggleFolder={toggleFolder}
              forceOpen={forceOpen}
              onSelectDoc={onSelectDoc}
              onOpenDocInNewTab={onOpenDocInNewTab}
              drag={drag}
              setDrag={setDrag}
              onDropOnFolder={onDropOnFolder}
              onRequestDeleteDoc={onRequestDeleteDoc}
              onRequestDeleteFolder={onRequestDeleteFolder}
            />
          ))}
        </div>
      )}
    </FolderRow>
  );
}

function FolderRow({
  node,
  open,
  onToggle,
  canAcceptDrop,
  onDropDoc,
  onRequestDelete,
  children,
}: {
  node: Extract<TreeNode, { type: "folder" }>;
  open: boolean;
  onToggle: () => void;
  canAcceptDrop: boolean;
  onDropDoc: () => void;
  onRequestDelete: () => void;
  children?: React.ReactNode;
}) {
  const [over, setOver] = React.useState(false);
  return (
    <div>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <button
            onClick={onToggle}
            onDragOver={(e) => {
              if (!canAcceptDrop) return;
              e.preventDefault();
              e.stopPropagation();
              e.dataTransfer.dropEffect = "move";
              if (!over) setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              if (!canAcceptDrop) return;
              e.preventDefault();
              e.stopPropagation();
              setOver(false);
              onDropDoc();
            }}
            className={cn(
              "w-full flex items-center gap-2 px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary/50 rounded-md transition-colors ml-2",
              over && "ring-1 ring-primary bg-primary/10 text-foreground",
            )}
          >
            {open ? (
              <ChevronDown className="size-3" />
            ) : (
              <ChevronRight className="size-3" />
            )}
            <Folder className="size-3" />
            <span className="truncate">{node.name}</span>
          </button>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem
            variant="destructive"
            onClick={() => onRequestDelete()}
          >
            <Trash2 />
            Delete folder
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      {children}
    </div>
  );
}

function filterTree(nodes: TreeNode[], q: string): TreeNode[] {
  const out: TreeNode[] = [];
  for (const n of nodes) {
    if (n.type === "doc") {
      if (n.title.toLowerCase().includes(q)) out.push(n);
    } else {
      const children = filterTree(n.children, q);
      if (children.length > 0) out.push({ ...n, children });
    }
  }
  return out;
}

// Re-export so callers can reuse the path helper if needed.
export { pathToDoc };
