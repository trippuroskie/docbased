"use client"

import { useState } from "react"
import { Sidebar } from "@/components/knowledge-hub/sidebar"
import { DocumentViewer } from "@/components/knowledge-hub/document-viewer"
import { ChatPanel } from "@/components/knowledge-hub/chat-panel"
import { TopBar } from "@/components/knowledge-hub/top-bar"
import { ResizablePanel } from "@/components/knowledge-hub/resizable-panel"

export default function KnowledgeHub() {
  const [selectedDocId, setSelectedDocId] = useState("vpn-runbook")
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [chatPanelCollapsed, setChatPanelCollapsed] = useState(false)

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Top Bar */}
      <TopBar />
      
      {/* Main Content - Three Panes */}
      <div className="flex-1 flex min-h-0">
        {/* Left Pane - Navigation Sidebar */}
        <Sidebar 
          selectedDocId={selectedDocId} 
          onSelectDoc={setSelectedDocId}
          isCollapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
        />
        
        {/* Center Pane - Document Viewer */}
        <DocumentViewer />
        
        {/* Right Pane - AI Chat Panel (Resizable & Collapsible) */}
        <ResizablePanel
          defaultWidth={380}
          minWidth={280}
          maxWidth={600}
          position="right"
          isCollapsed={chatPanelCollapsed}
          onToggleCollapse={() => setChatPanelCollapsed(!chatPanelCollapsed)}
        >
          <ChatPanel />
        </ResizablePanel>
      </div>
    </div>
  )
}
