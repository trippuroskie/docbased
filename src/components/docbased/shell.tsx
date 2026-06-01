"use client";

import { useState } from "react";
import { Sidebar } from "./sidebar";
import { DocumentViewer } from "./document-viewer";
import { ChatPanel } from "./chat-panel";
import { TopBar } from "./top-bar";
import { ResizablePanel } from "./resizable-panel";
import type { ChatUser, DocPayload, SpaceWithTree } from "./types";

export function DocbasedShell({
  user,
  spaces,
  selectedDocId,
  doc,
}: {
  user: ChatUser;
  spaces: SpaceWithTree[];
  selectedDocId: string | null;
  doc: DocPayload | null;
}) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [chatPanelCollapsed, setChatPanelCollapsed] = useState(false);

  const docSpace = doc ? spaces.find((s) => s.id === doc.spaceId) ?? null : null;
  const headerSpace = docSpace ?? spaces[0] ?? null;

  return (
    <div className="fixed inset-0 flex flex-col bg-background overflow-hidden">
      <TopBar user={user} space={headerSpace} />
      <div className="flex-1 flex min-h-0 overflow-hidden">
        <Sidebar
          spaces={spaces}
          selectedDocId={selectedDocId}
          isCollapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
          user={user}
        />
        <DocumentViewer doc={doc} space={docSpace} />
        <ResizablePanel
          defaultWidth={380}
          minWidth={280}
          maxWidth={600}
          position="right"
          isCollapsed={chatPanelCollapsed}
          onToggleCollapse={() => setChatPanelCollapsed(!chatPanelCollapsed)}
        >
          <ChatPanel
            spaces={spaces.map((s) => ({ id: s.id, name: s.name }))}
          />
        </ResizablePanel>
      </div>
    </div>
  );
}
