"use client";

import * as React from "react";
import Link from "next/link";
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
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
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
  const [activeTab, setActiveTab] = React.useState<string>("docs");
  const [chatSearch, setChatSearch] = React.useState("");
  const [docSearch, setDocSearch] = React.useState("");
  const [expandedSpaces, setExpandedSpaces] = React.useState<Set<string>>(
    () => new Set(spaces.length > 0 ? [spaces[0].id] : []),
  );
  const [expandedFolders, setExpandedFolders] = React.useState<Set<string>>(
    new Set(),
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
              return (
                <div key={space.id} className="mb-2">
                  <button
                    onClick={() => !docSearch.trim() && toggleSpace(space.id)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 text-sm font-medium hover:bg-secondary/50 rounded-md transition-colors"
                  >
                    {open ? (
                      <ChevronDown className="size-3.5 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="size-3.5 text-muted-foreground" />
                    )}
                    <span
                      className={cn("size-2 rounded-full shrink-0", space.color)}
                    />
                    <span className="truncate flex-1 text-left">
                      {space.name}
                    </span>
                  </button>
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

function DocTreeNode({
  node,
  spaceId,
  expandedFolders,
  toggleFolder,
  forceOpen,
  onSelectDoc,
  onOpenDocInNewTab,
}: {
  node: TreeNode;
  spaceId: string;
  expandedFolders: Set<string>;
  toggleFolder: (key: string) => void;
  forceOpen: boolean;
  onSelectDoc: (docId: string) => void;
  onOpenDocInNewTab: (docId: string) => void;
}) {
  if (node.type === "doc") {
    return (
      <button
        onClick={() => onSelectDoc(node.id)}
        onDoubleClick={() => onOpenDocInNewTab(node.id)}
        title="Click to preview · Double-click to open in a new tab"
        className="w-full flex items-center gap-2 px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary/50 rounded-md transition-colors ml-2"
      >
        <FileText className="size-3 shrink-0" />
        <span className="truncate text-left flex-1">{node.title}</span>
        {node.status === "indexed" ? (
          <Check className="size-3 ml-auto shrink-0 text-emerald-500" />
        ) : node.status === "metadata_only" ? (
          <Paperclip className="size-3 ml-auto shrink-0" />
        ) : null}
      </button>
    );
  }

  const key = `${spaceId}:${node.path}`;
  const open = forceOpen || expandedFolders.has(key);
  return (
    <div>
      <button
        onClick={() => !forceOpen && toggleFolder(key)}
        className="w-full flex items-center gap-2 px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary/50 rounded-md transition-colors ml-2"
      >
        {open ? (
          <ChevronDown className="size-3" />
        ) : (
          <ChevronRight className="size-3" />
        )}
        <Folder className="size-3" />
        <span className="truncate">{node.name}</span>
      </button>
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
            />
          ))}
        </div>
      )}
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
