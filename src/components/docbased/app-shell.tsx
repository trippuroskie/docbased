"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { ChatSidebar, type ChatSummary } from "./chat-sidebar";
import type { SpaceWithTree } from "./types";

interface AppShellProps {
  spacesWithTrees: SpaceWithTree[];
  isAdmin: boolean;
  userDisplayName: string | null;
  userEmail: string | null;
  children: React.ReactNode;
}

/**
 * Layout-level shell that renders the persistent left sidebar on every (app)
 * route. Sidebar state (collapsed, conversation history) lives here so it
 * survives client-side navigation between /, /settings, /admin/*, etc.
 *
 * Navigation actions from the sidebar (open doc, select conversation, new
 * chat) all route via the URL using the home page's search params:
 *   /?doc=<id>     -> opens that doc in the hub's center pane
 *   /?conv=<id>    -> loads that conversation in the hub's chat pane
 *   /              -> empty hub / new chat
 *
 * The hub page reads these params on render and reflects the state.
 */
export function AppShell({
  spacesWithTrees,
  isAdmin,
  userDisplayName,
  userEmail,
  children,
}: AppShellProps) {
  const router = useRouter();
  const pathname = usePathname();

  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false);
  const [history, setHistory] = React.useState<ChatSummary[]>([]);
  const [historyLoading, setHistoryLoading] = React.useState(false);

  // The "active conversation" is whichever conv is in the URL when we're on
  // the hub. On any other route there's no active conversation visible.
  const [currentConversationId, setCurrentConversationId] = React.useState<
    string | null
  >(null);

  const refreshHistory = React.useCallback(async () => {
    setHistoryLoading(true);
    try {
      const resp = await fetch("/api/chat/conversations");
      if (!resp.ok) return;
      const data = (await resp.json()) as { conversations: ChatSummary[] };
      setHistory(data.conversations);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void refreshHistory();
  }, [refreshHistory]);

  // The hub page tells us which conversation it currently has loaded so the
  // sidebar can highlight the active row. We listen via a window-level event
  // dispatched from the hub.
  React.useEffect(() => {
    const onActive = (e: Event) => {
      const detail = (e as CustomEvent<{ id: string | null }>).detail;
      setCurrentConversationId(detail?.id ?? null);
    };
    const onHistoryRefresh = () => {
      void refreshHistory();
    };
    window.addEventListener("hub:active-conversation", onActive);
    window.addEventListener("hub:refresh-conversations", onHistoryRefresh);
    return () => {
      window.removeEventListener("hub:active-conversation", onActive);
      window.removeEventListener("hub:refresh-conversations", onHistoryRefresh);
    };
  }, [refreshHistory]);

  // If we leave the hub, drop the highlight — there's no "current conversation"
  // visible anywhere off-route.
  React.useEffect(() => {
    if (pathname !== "/") setCurrentConversationId(null);
  }, [pathname]);

  const goToConversation = React.useCallback(
    (id: string) => {
      router.push(`/?conv=${encodeURIComponent(id)}`);
    },
    [router],
  );

  const goToNewChat = React.useCallback(() => {
    router.push("/");
  }, [router]);

  const deleteConversation = React.useCallback(
    async (id: string) => {
      const resp = await fetch(`/api/chat/conversations/${id}`, {
        method: "DELETE",
      });
      if (!resp.ok) return;
      setHistory((prev) => prev.filter((c) => c.id !== id));
      if (id === currentConversationId) goToNewChat();
    },
    [currentConversationId, goToNewChat],
  );

  // Sidebar doc clicks: if we're already on the hub, dispatch a window event
  // so the hub opens the doc in-place (preserving its tab/chat state). On any
  // other route, navigate to /?doc=<id> so the hub mounts with that doc open.
  const openDocPreview = React.useCallback(
    (docId: string) => {
      if (pathname === "/") {
        window.dispatchEvent(
          new CustomEvent("hub:open-doc", {
            detail: { docId, pinned: false },
          }),
        );
      } else {
        router.push(`/?doc=${encodeURIComponent(docId)}`);
      }
    },
    [pathname, router],
  );

  const openDocPinned = React.useCallback(
    (docId: string) => {
      if (pathname === "/") {
        window.dispatchEvent(
          new CustomEvent("hub:open-doc", {
            detail: { docId, pinned: true },
          }),
        );
      } else {
        router.push(`/?doc=${encodeURIComponent(docId)}`);
      }
    },
    [pathname, router],
  );

  return (
    <div className="flex h-full bg-background min-h-0">
      <ChatSidebar
        isCollapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
        conversations={history}
        conversationsLoading={historyLoading}
        currentConversationId={currentConversationId}
        onSelectConversation={goToConversation}
        onDeleteConversation={(id) => void deleteConversation(id)}
        onNewChat={goToNewChat}
        spaces={spacesWithTrees}
        onSelectDoc={openDocPreview}
        onOpenDocInNewTab={openDocPinned}
        isAdmin={isAdmin}
        userDisplayName={userDisplayName}
        userEmail={userEmail}
      />
      <div className="flex-1 min-w-0 flex flex-col h-full min-h-0">
        {children}
      </div>
    </div>
  );
}
