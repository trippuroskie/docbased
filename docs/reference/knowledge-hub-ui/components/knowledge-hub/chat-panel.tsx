"use client"

import { useState } from "react"
import { Send, ChevronDown, FileText, Plus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

interface Message {
  id: string
  role: "user" | "assistant"
  content: string
  citations?: Citation[]
}

interface Citation {
  id: number
  title: string
  section: string
}

const initialMessages: Message[] = [
  {
    id: "1",
    role: "user",
    content: "How do I rotate the VPN pre-shared key?",
  },
  {
    id: "2",
    role: "assistant",
    content: `To rotate the VPN pre-shared key, you'll need to coordinate with the remote site administrator to ensure both endpoints are updated simultaneously. Here's the process:

First, generate a new pre-shared key and store it in the secure vault. The key should be at least 32 characters with a mix of uppercase, lowercase, numbers, and symbols.

During a scheduled maintenance window, update the Phase 1 configuration on both FortiGate devices using the CLI or web interface. The command structure is documented in the runbook's configuration section.

After updating both endpoints, the tunnel should re-establish automatically. Verify connectivity using the tunnel summary command and test with ping from both sites.`,
    citations: [
      { id: 1, title: "Site-to-site VPN runbook", section: "Step-by-step configuration" },
      { id: 2, title: "Site-to-site VPN runbook", section: "Verification" },
    ],
  },
  {
    id: "3",
    role: "user",
    content: "Does that rotation invalidate the existing tunnel?",
  },
  {
    id: "4",
    role: "assistant",
    content: `Based on the runbook, no — the rotation is hitless because FortiGate supports IKEv2's MOBIKE protocol which allows for seamless re-keying. The tunnel negotiates the new key through the existing secure channel before switching over.

However, if you're using IKEv1 or have MOBIKE disabled, there will be a brief interruption (typically 5-30 seconds) while the tunnel re-establishes with the new credentials. Plan your maintenance window accordingly for IKEv1 deployments.`,
    citations: [
      { id: 3, title: "Site-to-site VPN runbook", section: "Prerequisites" },
    ],
  },
]

const selectedSpaces = [
  { id: "it", name: "IT", selected: true },
  { id: "tripps-notes", name: "Tripp's Notes", selected: true },
]

export function ChatPanel() {
  const [messages] = useState<Message[]>(initialMessages)
  const [inputValue, setInputValue] = useState("")
  const [spaces, setSpaces] = useState(selectedSpaces)

  const toggleSpace = (id: string) => {
    setSpaces(spaces.map(s => 
      s.id === id ? { ...s, selected: !s.selected } : s
    ))
  }

  return (
    <div className="w-full border-l border-border flex flex-col h-full">
      {/* Header */}
      <div className="h-12 border-b border-border flex items-center justify-between px-4 shrink-0">
        <span className="text-sm font-medium">Ask anything</span>
        <button className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
          <span>Claude Sonnet 4.5</span>
          <ChevronDown className="size-3.5" />
        </button>
      </div>

      {/* Space Scope Chips */}
      <div className="px-4 py-3 border-b border-border flex items-center gap-2 flex-wrap">
        {spaces.map((space) => (
          <button
            key={space.id}
            onClick={() => toggleSpace(space.id)}
            className={cn(
              "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors",
              space.selected
                ? "bg-primary/15 text-primary"
                : "bg-secondary text-muted-foreground hover:text-foreground"
            )}
          >
            {space.name}
            {space.selected && <X className="size-3" />}
          </button>
        ))}
        <button className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
          <Plus className="size-3" />
          Add space
        </button>
      </div>

      {/* Chat Messages */}
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-6">
          {messages.map((message) => (
            <div key={message.id} className="space-y-3">
              {/* Message */}
              <div
                className={cn(
                  "text-sm leading-relaxed",
                  message.role === "user" 
                    ? "text-foreground" 
                    : "text-muted-foreground"
                )}
              >
                {message.role === "user" && (
                  <span className="text-xs font-medium text-muted-foreground block mb-1.5">You</span>
                )}
                {message.role === "assistant" && (
                  <span className="text-xs font-medium text-primary block mb-1.5">Assistant</span>
                )}
                <div className="whitespace-pre-wrap">
                  {message.content}
                  {message.citations && message.citations.length > 0 && (
                    <span className="inline-flex gap-1 ml-1">
                      {message.citations.map((citation) => (
                        <sup
                          key={citation.id}
                          className="inline-flex items-center justify-center size-4 rounded bg-primary/20 text-primary text-[10px] font-medium cursor-pointer hover:bg-primary/30 transition-colors"
                        >
                          {citation.id}
                        </sup>
                      ))}
                    </span>
                  )}
                </div>
              </div>

              {/* Citations */}
              {message.citations && message.citations.length > 0 && (
                <div className="space-y-1.5">
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                    Sources
                  </span>
                  <div className="flex flex-col gap-1.5">
                    {message.citations.map((citation) => (
                      <a
                        key={citation.id}
                        href="#"
                        className="flex items-center gap-2 p-2 rounded border border-border hover:bg-secondary/50 transition-colors group"
                      >
                        <sup className="flex items-center justify-center size-4 rounded bg-primary/20 text-primary text-[10px] font-medium shrink-0">
                          {citation.id}
                        </sup>
                        <FileText className="size-3.5 text-muted-foreground shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium text-foreground truncate group-hover:text-primary transition-colors">
                            {citation.title}
                          </p>
                          <p className="text-[10px] text-muted-foreground truncate">
                            {citation.section}
                          </p>
                        </div>
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </ScrollArea>

      {/* Input Area */}
      <div className="border-t border-border p-4 space-y-2">
        <div className="relative">
          <Textarea
            placeholder="Ask anything across IT, Tripp's Notes..."
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            rows={3}
            className="min-h-[80px] resize-none bg-secondary/50 pr-12"
          />
          <Button
            size="icon-sm"
            className="absolute bottom-2 right-2 size-7 bg-primary hover:bg-primary/90"
          >
            <Send className="size-3.5" />
          </Button>
        </div>
        <div className="flex justify-end">
          <span className="text-[10px] text-muted-foreground">
            50 / 50 messages left today
          </span>
        </div>
      </div>
    </div>
  )
}
