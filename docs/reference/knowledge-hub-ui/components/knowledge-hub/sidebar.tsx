"use client"

import { useState } from "react"
import {
  Search,
  ChevronRight,
  ChevronDown,
  FileText,
  Paperclip,
  Check,
  Settings,
  Folder,
  Layers,
  PanelLeftClose,
  PanelLeft,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"

interface Document {
  id: string
  title: string
  indexed: boolean
}

interface FolderItem {
  id: string
  name: string
  documents?: Document[]
  subfolders?: FolderItem[]
  expanded?: boolean
}

interface Space {
  id: string
  name: string
  color: string
  expanded: boolean
  folders: FolderItem[]
}

const initialSpaces: Space[] = [
  {
    id: "it",
    name: "IT",
    color: "bg-indigo-500",
    expanded: true,
    folders: [
      {
        id: "networking",
        name: "Networking",
        expanded: true,
        documents: [
          { id: "vpn-runbook", title: "Site-to-site VPN runbook", indexed: true },
          { id: "vlan-inventory", title: "VLAN inventory", indexed: true },
          { id: "firewall-changelog", title: "Firewall change log", indexed: false },
        ],
      },
      {
        id: "identity",
        name: "Identity",
        expanded: false,
        documents: [
          { id: "sso-setup", title: "SSO configuration guide", indexed: true },
          { id: "ad-policies", title: "Active Directory policies", indexed: true },
        ],
      },
      {
        id: "endpoints",
        name: "Endpoints",
        expanded: false,
        documents: [
          { id: "mdm-enrollment", title: "MDM enrollment process", indexed: true },
        ],
      },
      {
        id: "vendors",
        name: "Vendors",
        expanded: false,
        documents: [
          { id: "vendor-contacts", title: "Vendor escalation contacts", indexed: true },
        ],
      },
    ],
  },
  {
    id: "ecomm",
    name: "Ecomm",
    color: "bg-emerald-500",
    expanded: false,
    folders: [
      {
        id: "integrations",
        name: "Integrations",
        expanded: false,
        documents: [
          { id: "shopify-setup", title: "Shopify integration", indexed: true },
        ],
      },
    ],
  },
  {
    id: "tripps-notes",
    name: "Tripp's Notes",
    color: "bg-amber-500",
    expanded: false,
    folders: [
      {
        id: "meetings",
        name: "Meeting Notes",
        expanded: false,
        documents: [
          { id: "weekly-standup", title: "Weekly standup notes", indexed: true },
        ],
      },
    ],
  },
]

interface SidebarProps {
  selectedDocId: string
  onSelectDoc: (docId: string) => void
  isCollapsed: boolean
  onToggleCollapse: () => void
}

export function Sidebar({ selectedDocId, onSelectDoc, isCollapsed, onToggleCollapse }: SidebarProps) {
  const [spaces, setSpaces] = useState<Space[]>(initialSpaces)
  const [searchQuery, setSearchQuery] = useState("")

  const toggleSpace = (spaceId: string) => {
    setSpaces(spaces.map(space => 
      space.id === spaceId ? { ...space, expanded: !space.expanded } : space
    ))
  }

  const toggleFolder = (spaceId: string, folderId: string) => {
    setSpaces(spaces.map(space => {
      if (space.id !== spaceId) return space
      return {
        ...space,
        folders: space.folders.map(folder =>
          folder.id === folderId ? { ...folder, expanded: !folder.expanded } : folder
        ),
      }
    }))
  }

  return (
    <div className={cn(
      "border-r border-border flex flex-col h-full transition-all duration-200",
      isCollapsed ? "w-[60px]" : "w-[260px]"
    )}>
      {/* Logo, Search, and Collapse Toggle */}
      <div className={cn("p-4", isCollapsed ? "px-2" : "space-y-4")}>
        <div className="flex items-center justify-between">
          <div className={cn("flex items-center gap-2", isCollapsed && "justify-center w-full")}>
            <div className="size-6 rounded bg-primary/20 flex items-center justify-center shrink-0">
              <Layers className="size-3.5 text-primary" />
            </div>
            {!isCollapsed && <span className="font-semibold text-sm">Knowledge Hub</span>}
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
          <Button
            variant="ghost"
            size="icon"
            className="w-full h-8 mt-3"
            onClick={onToggleCollapse}
          >
            <PanelLeft className="size-4 text-muted-foreground" />
          </Button>
        ) : (
          <div className="relative">
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
          </div>
        )}
      </div>

      {/* Navigation Tree */}
      <ScrollArea className="flex-1 px-2">
        <div className="space-y-1 pb-4">
          {spaces.map((space) => (
            <div key={space.id}>
              {/* Space Header */}
              <button
                onClick={() => !isCollapsed && toggleSpace(space.id)}
                className={cn(
                  "w-full flex items-center gap-2 px-2 py-1.5 text-sm font-medium text-foreground hover:bg-secondary/50 rounded-md transition-colors",
                  isCollapsed && "justify-center px-0"
                )}
                title={isCollapsed ? space.name : undefined}
              >
                {!isCollapsed && (space.expanded ? (
                  <ChevronDown className="size-4 text-muted-foreground" />
                ) : (
                  <ChevronRight className="size-4 text-muted-foreground" />
                ))}
                <span className={cn("size-2 rounded-full shrink-0", space.color)} />
                {!isCollapsed && <span>{space.name}</span>}
              </button>

              {/* Folders */}
              {space.expanded && !isCollapsed && (
                <div className="ml-4 border-l border-border/50">
                  {space.folders.map((folder) => (
                    <div key={folder.id}>
                      <button
                        onClick={() => toggleFolder(space.id, folder.id)}
                        className="w-full flex items-center gap-2 px-2 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-secondary/50 rounded-md transition-colors ml-2"
                      >
                        {folder.expanded ? (
                          <ChevronDown className="size-3.5" />
                        ) : (
                          <ChevronRight className="size-3.5" />
                        )}
                        <Folder className="size-3.5" />
                        <span>{folder.name}</span>
                      </button>

                      {/* Documents */}
                      {folder.expanded && folder.documents && (
                        <div className="ml-6 border-l border-border/50">
                          {folder.documents.map((doc) => (
                            <button
                              key={doc.id}
                              onClick={() => onSelectDoc(doc.id)}
                              className={cn(
                                "w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-md transition-colors ml-2",
                                selectedDocId === doc.id
                                  ? "bg-primary/15 text-primary"
                                  : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                              )}
                            >
                              <FileText className="size-3.5 shrink-0" />
                              <span className="truncate text-left">{doc.title}</span>
                              {doc.indexed ? (
                                <Check className="size-3 ml-auto shrink-0 text-emerald-500" />
                              ) : (
                                <Paperclip className="size-3 ml-auto shrink-0" />
                              )}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </ScrollArea>

      {/* User Section */}
      <div className={cn(
        "border-t border-border p-3 flex items-center",
        isCollapsed ? "justify-center" : "gap-3"
      )}>
        <Avatar className="size-7 shrink-0">
          <AvatarFallback className="text-xs bg-secondary text-foreground">TR</AvatarFallback>
        </Avatar>
        {!isCollapsed && (
          <>
            <span className="text-sm font-medium flex-1 truncate">Tripp Robinson</span>
            <button className="p-1.5 hover:bg-secondary rounded-md transition-colors">
              <Settings className="size-4 text-muted-foreground" />
            </button>
          </>
        )}
      </div>
    </div>
  )
}
