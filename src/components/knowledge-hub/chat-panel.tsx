"use client";

import * as React from "react";
import Link from "next/link";
import {
  Send,
  ChevronDown,
  FileText,
  Plus,
  X,
  Loader2,
  Check,
  History,
  SquarePen,
  Trash2,
  Maximize2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Markdown } from "@/components/markdown";
import { cn } from "@/lib/utils";
import { CHAT_MODEL_ALLOWLIST } from "@/lib/env";
import { stripCitationTags } from "@/lib/chat";

type Source = {
  n: number;
  documentId: string;
  chunkId: string;
  title: string;
  headingPath: string[];
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
  error?: boolean;
};

type ConversationSummary = {
  id: string;
  title: string | null;
  created_at: string;
};

type StoredMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations: Source[] | null;
  created_at: string;
};

interface ChatPanelProps {
  spaces: Array<{ id: string; name: string }>;
}

const SHORT_NAMES: Record<string, string> = {
  "anthropic/claude-sonnet-4.5": "Claude Sonnet 4.5",
  "anthropic/claude-opus-4": "Claude Opus 4",
  "anthropic/claude-haiku-4.5": "Claude Haiku 4.5",
  "openai/gpt-5": "GPT-5",
  "google/gemini-2.5-pro": "Gemini 2.5 Pro",
};

const CITE_RE = /<cite\s+source=["'](\d+)["']\s*\/?>/g;

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

function parseSse(raw: string): { event: string; data: string } | null {
  const lines = raw.split("\n");
  let event = "message";
  const dataLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  if (!dataLines.length) return null;
  return { event, data: dataLines.join("\n") };
}

export function ChatPanel({ spaces }: ChatPanelProps) {
  const [model, setModel] = React.useState<string>(CHAT_MODEL_ALLOWLIST[0]);
  const [selectedSpaceIds, setSelectedSpaceIds] = React.useState<string[]>(
    () => spaces.map((s) => s.id),
  );
  const [conversationId, setConversationId] = React.useState<string | null>(
    null,
  );
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [rateInfo, setRateInfo] = React.useState<string | null>(null);
  const [history, setHistory] = React.useState<ConversationSummary[]>([]);
  const [historyLoading, setHistoryLoading] = React.useState(false);
  const scrollRef = React.useRef<HTMLDivElement | null>(null);

  const refreshHistory = React.useCallback(async () => {
    setHistoryLoading(true);
    try {
      const resp = await fetch("/api/chat/conversations");
      if (!resp.ok) return;
      const data = (await resp.json()) as { conversations: ConversationSummary[] };
      setHistory(data.conversations);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void refreshHistory();
  }, [refreshHistory]);

  const startNewChat = () => {
    setConversationId(null);
    setMessages([]);
    setInputValue("");
  };

  const loadConversation = async (id: string) => {
    if (busy) return;
    try {
      setBusy(true);
      const resp = await fetch(`/api/chat/conversations/${id}`);
      if (!resp.ok) return;
      const data = (await resp.json()) as {
        conversation: { id: string; title: string | null; spaceIds: string[] };
        messages: StoredMessage[];
      };
      setConversationId(data.conversation.id);
      if (data.conversation.spaceIds.length > 0) {
        // Restrict scope to conversation's recorded spaces if any.
        setSelectedSpaceIds(
          data.conversation.spaceIds.filter((sid) =>
            spaces.some((s) => s.id === sid),
          ),
        );
      }
      setMessages(
        data.messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          sources: m.citations ?? undefined,
        })),
      );
    } finally {
      setBusy(false);
    }
  };

  const deleteConversation = async (id: string) => {
    const resp = await fetch(`/api/chat/conversations/${id}`, {
      method: "DELETE",
    });
    if (!resp.ok) return;
    setHistory((prev) => prev.filter((c) => c.id !== id));
    if (id === conversationId) startNewChat();
  };

  const selectedSpaces = spaces.filter((s) =>
    selectedSpaceIds.includes(s.id),
  );
  const unselectedSpaces = spaces.filter(
    (s) => !selectedSpaceIds.includes(s.id),
  );

  const toggleSpace = (id: string) => {
    setSelectedSpaceIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  React.useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const send = async () => {
    const text = inputValue.trim();
    if (!text || busy) return;

    setInputValue("");
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
    };
    const assistantId = crypto.randomUUID();
    setMessages((prev) => [
      ...prev,
      userMsg,
      { id: assistantId, role: "assistant", content: "" },
    ]);
    setBusy(true);

    try {
      const resp = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: conversationId ?? undefined,
          message: text,
          spaceIds:
            selectedSpaceIds.length > 0 ? selectedSpaceIds : undefined,
          model,
        }),
      });

      if (!resp.ok || !resp.body) {
        const err = await resp.json().catch(() => ({}));
        const msg =
          err.error === "rate_limited"
            ? `Daily message limit reached (${err.limit}/day).`
            : `Error: ${err.error ?? resp.statusText}`;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, content: msg, error: true } : m,
          ),
        );
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let sources: Source[] = [];

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let sep;
        while ((sep = buffer.indexOf("\n\n")) !== -1) {
          const raw = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          const event = parseSse(raw);
          if (!event) continue;
          if (event.event === "meta") {
            const data = JSON.parse(event.data);
            setConversationId(data.conversationId);
            sources = data.sources;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, sources } : m,
              ),
            );
          } else if (event.event === "token") {
            const { delta } = JSON.parse(event.data);
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, content: m.content + delta }
                  : m,
              ),
            );
          } else if (event.event === "error") {
            const { message } = JSON.parse(event.data);
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, content: `Error: ${message}`, error: true }
                  : m,
              ),
            );
          }
        }
      }
    } catch (err) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, content: `Error: ${(err as Error).message}`, error: true }
            : m,
        ),
      );
    } finally {
      setBusy(false);
      void refreshHistory();
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="w-full border-l border-border flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="h-12 border-b border-border flex items-center justify-between px-4 shrink-0 gap-2">
        <span className="text-sm font-medium truncate">Ask anything</span>
        <div className="flex items-center gap-1 shrink-0">
          <DropdownMenu onOpenChange={(open) => open && void refreshHistory()}>
            <DropdownMenuTrigger
              title="Chat history"
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors outline-none"
            >
              <History className="size-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="min-w-[260px] max-w-[320px] max-h-[400px] overflow-y-auto"
            >
              {historyLoading && history.length === 0 && (
                <div className="px-2 py-2 text-xs text-muted-foreground">
                  Loading…
                </div>
              )}
              {!historyLoading && history.length === 0 && (
                <div className="px-2 py-2 text-xs text-muted-foreground">
                  No previous conversations.
                </div>
              )}
              {history.map((c) => (
                <DropdownMenuItem
                  key={c.id}
                  onClick={() => void loadConversation(c.id)}
                  className={cn(
                    "text-xs flex items-start gap-2 group",
                    c.id === conversationId &&
                      "bg-primary/10 text-primary focus:bg-primary/15",
                  )}
                >
                  <div className="flex-1 min-w-0">
                    <p className="truncate font-medium">
                      {c.title ?? "(untitled)"}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {formatRelative(c.created_at)}
                    </p>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      void deleteConversation(c.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-destructive/20 hover:text-destructive transition-opacity"
                    title="Delete conversation"
                  >
                    <Trash2 className="size-3" />
                  </button>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <button
            onClick={startNewChat}
            title="New chat"
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors outline-none"
          >
            <SquarePen className="size-3.5" />
          </button>
          <Link
            href="/chat/new"
            title="Open full-screen chat"
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors outline-none"
          >
            <Maximize2 className="size-3.5" />
          </Link>
          <DropdownMenu>
            <DropdownMenuTrigger className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors outline-none ml-1">
              <span>{SHORT_NAMES[model] ?? model}</span>
              <ChevronDown className="size-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[200px]">
              {CHAT_MODEL_ALLOWLIST.map((m) => (
                <DropdownMenuItem
                  key={m}
                  onClick={() => setModel(m)}
                  className="text-xs"
                >
                  <span className="flex-1">{SHORT_NAMES[m] ?? m}</span>
                  {m === model && <Check className="size-3 ml-2" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Space Scope Chips */}
      {spaces.length > 0 && (
        <div className="px-4 py-3 border-b border-border flex items-center gap-2 flex-wrap">
          {selectedSpaces.map((space) => (
            <button
              key={space.id}
              onClick={() => toggleSpace(space.id)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors bg-primary/15 text-primary"
            >
              {space.name}
              <X className="size-3" />
            </button>
          ))}
          {unselectedSpaces.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors outline-none">
                <Plus className="size-3" />
                Add space
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-[180px]">
                {unselectedSpaces.map((s) => (
                  <DropdownMenuItem
                    key={s.id}
                    onClick={() => toggleSpace(s.id)}
                    className="text-xs"
                  >
                    {s.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      )}

      {/* Chat Messages */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div ref={scrollRef} className="p-4 space-y-6">
          {messages.length === 0 && (
            <div className="text-center text-xs text-muted-foreground px-4 py-8">
              Ask a question about your accessible spaces. Answers cite their
              sources — always verify before relying on the result.
            </div>
          )}
          {messages.map((message) => {
            const cited = new Set<number>();
            let citeMatch: RegExpExecArray | null;
            CITE_RE.lastIndex = 0;
            while ((citeMatch = CITE_RE.exec(message.content)) !== null) {
              cited.add(Number(citeMatch[1]));
            }
            // Filter to cited sources, dedupe by citation number (n) — stored
            // citations can have repeats when the same source was referenced
            // multiple times.
            const seen = new Set<number>();
            const rawSources =
              message.sources && message.sources.length > 0
                ? message.sources
                : [];
            const messageSources = rawSources.filter((s) => {
              if (cited.size > 0 && !cited.has(s.n)) return false;
              if (seen.has(s.n)) return false;
              seen.add(s.n);
              return true;
            });

            return (
              <div key={message.id} className="space-y-3">
                <div className="text-sm leading-relaxed">
                  {message.role === "user" && (
                    <span className="text-xs font-medium text-muted-foreground block mb-1.5">
                      You
                    </span>
                  )}
                  {message.role === "assistant" && (
                    <span className="text-xs font-medium text-primary block mb-1.5">
                      Assistant
                    </span>
                  )}
                  {message.role === "user" ? (
                    <div className="whitespace-pre-wrap text-foreground">
                      {message.content}
                    </div>
                  ) : message.content ? (
                    <div
                      className={cn(
                        "[&_p:first-child]:mt-0 [&_p:last-child]:mb-0",
                        message.error && "text-destructive",
                      )}
                    >
                      <Markdown source={stripCitationTags(message.content)} />
                    </div>
                  ) : (
                    <span className="opacity-50 text-muted-foreground">…</span>
                  )}
                </div>

                {messageSources.length > 0 && (
                  <div className="space-y-1.5">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                      Sources
                    </span>
                    <div className="flex flex-col gap-1.5">
                      {messageSources.map((s) => (
                        <a
                          key={`${message.id}-${s.n}`}
                          href={`/?doc=${s.documentId}`}
                          className="flex items-center gap-2 p-2 rounded border border-border hover:bg-secondary/50 transition-colors group"
                        >
                          <sup className="flex items-center justify-center size-4 rounded bg-primary/20 text-primary text-[10px] font-medium shrink-0">
                            {s.n}
                          </sup>
                          <FileText className="size-3.5 text-muted-foreground shrink-0" />
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-medium text-foreground truncate group-hover:text-primary transition-colors">
                              {s.title}
                            </p>
                            {Array.isArray(s.headingPath) &&
                              s.headingPath.length > 0 && (
                                <p className="text-[10px] text-muted-foreground truncate">
                                  {s.headingPath.join(" › ")}
                                </p>
                              )}
                          </div>
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {busy && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-3 animate-spin" /> thinking…
            </div>
          )}
        </div>
      </div>

      {/* Input Area */}
      <div className="border-t border-border p-4 space-y-2">
        <div className="relative">
          <Textarea
            placeholder={
              selectedSpaces.length > 0
                ? `Ask anything across ${selectedSpaces.map((s) => s.name).join(", ")}…`
                : "Ask a question…"
            }
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={onKeyDown}
            rows={3}
            disabled={busy}
            className="min-h-[80px] resize-none bg-secondary/50 pr-12"
          />
          <Button
            size="icon-sm"
            disabled={busy || !inputValue.trim()}
            onClick={send}
            className="absolute bottom-2 right-2 size-7 bg-primary hover:bg-primary/90"
          >
            {busy ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Send className="size-3.5" />
            )}
          </Button>
        </div>
        <div className="flex justify-end">
          <span className="text-[10px] text-muted-foreground">
            {rateInfo ?? "⌘+Enter to send"}
          </span>
        </div>
      </div>
    </div>
  );
}
