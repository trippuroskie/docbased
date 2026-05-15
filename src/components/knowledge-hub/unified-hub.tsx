"use client";

import * as React from "react";
import {
  Send,
  ChevronDown,
  FileText,
  Loader2,
  Check,
  Sparkles,
  X,
  Wrench,
  AlertCircle,
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
import { ChatSidebar, type ChatSummary } from "./chat-sidebar";
import { ResizablePanel } from "./resizable-panel";
import type { SpaceWithTree } from "./types";
import type { TreeNode } from "@/lib/tree";

// ---------- Types ----------

type WorkspaceChatSpace = { id: string; name: string; color: string };

type Source = {
  n: number;
  documentId: string;
  chunkId: string;
  title: string;
  headingPath: string[];
};

type Status =
  | { kind: "searching"; spaceCount: number; message: string }
  | { kind: "searched"; chunkCount: number; message: string }
  | { kind: "reranked"; keptCount: number; message: string }
  | { kind: "thinking"; message: string };

type ToolCallStep = {
  type: "tool";
  id: string;
  name: string;
  args: Record<string, unknown>;
  state: "running" | "ok" | "error";
  summary?: string;
};

type StatusStep = { type: "status"; data: Status; done: boolean };
type Step = ToolCallStep | StatusStep;

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
  steps?: Step[];
  error?: boolean;
};

type StoredMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations: Source[] | null;
  created_at: string;
};

type DocState = {
  id: string;
  title: string;
  path: string;
  workspace: string;
  status: "indexed" | "metadata_only" | "failed" | "pending";
  tags: string[];
  content: string;
  loading: boolean;
};

const SHORT_NAMES: Record<string, string> = {
  "anthropic/claude-sonnet-4.5": "Claude Sonnet 4.5",
  "anthropic/claude-opus-4": "Claude Opus 4",
  "anthropic/claude-haiku-4.5": "Claude Haiku 4.5",
  "openai/gpt-5": "GPT-5",
  "google/gemini-2.5-pro": "Gemini 2.5 Pro",
};

const CITE_RE = /<cite\s+source=["'](\d+)["']\s*\/?>/g;

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

function findDocInTree(
  nodes: TreeNode[],
  docId: string,
): { title: string; path: string } | null {
  for (const n of nodes) {
    if (n.type === "doc") {
      if (n.id === docId) return { title: n.title, path: n.path };
    } else {
      const found = findDocInTree(n.children, docId);
      if (found) return found;
    }
  }
  return null;
}

// ---------- Unified Hub ----------

interface UnifiedHubProps {
  spaces: WorkspaceChatSpace[];
  spacesWithTrees: SpaceWithTree[];
  isAdmin: boolean;
  userDisplayName?: string | null;
  userEmail?: string | null;
  initialDocId?: string;
  initialQuery?: string;
}

export function UnifiedHub({
  spaces,
  spacesWithTrees,
  isAdmin,
  userDisplayName,
  userEmail,
  initialDocId,
  initialQuery,
}: UnifiedHubProps) {
  // Layout
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false);
  const [chatCollapsed, setChatCollapsed] = React.useState(false);

  // Document center pane
  const [doc, setDoc] = React.useState<DocState | null>(null);

  // Chat right pane
  const [model, setModel] = React.useState<string>(CHAT_MODEL_ALLOWLIST[0]);
  const [selectedSpaceIds, setSelectedSpaceIds] = React.useState<string[]>(
    () => spaces.map((s) => s.id),
  );
  const [conversationId, setConversationId] = React.useState<string | null>(
    null,
  );
  const [messages, setMessages] = React.useState<Message[]>([]);
  const [inputValue, setInputValue] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  // Sidebar data
  const [history, setHistory] = React.useState<ChatSummary[]>([]);
  const [historyLoading, setHistoryLoading] = React.useState(false);
  const initFired = React.useRef(false);

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

  const loadDoc = React.useCallback(
    async (docId: string) => {
      let title = "Document";
      let path = "";
      let workspace = "";
      for (const s of spacesWithTrees) {
        const found = findDocInTree(s.tree, docId);
        if (found) {
          title = found.title;
          path = found.path;
          workspace = s.name;
          break;
        }
      }
      setDoc({
        id: docId,
        title,
        path,
        workspace,
        status: "indexed",
        tags: [],
        content: "",
        loading: true,
      });

      try {
        const resp = await fetch(`/api/documents/${docId}`);
        if (!resp.ok) {
          setDoc((p) =>
            p
              ? { ...p, loading: false, content: "Could not load document." }
              : p,
          );
          return;
        }
        const data = (await resp.json()) as {
          document: {
            id: string;
            title: string;
            path: string;
            workspace: string;
            status: DocState["status"];
            tags: string[];
            content: string;
          };
        };
        setDoc({ ...data.document, loading: false });
      } catch {
        setDoc((p) =>
          p
            ? { ...p, loading: false, content: "Could not load document." }
            : p,
        );
      }
    },
    [spacesWithTrees],
  );

  // Initial doc from URL
  React.useEffect(() => {
    if (initialDocId && !doc) void loadDoc(initialDocId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialDocId]);

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

  const send = React.useCallback(
    async (text: string) => {
      const userMsg: Message = {
        id: crypto.randomUUID(),
        role: "user",
        content: text,
      };
      const assistantId = crypto.randomUUID();
      setMessages((prev) => [
        ...prev,
        userMsg,
        { id: assistantId, role: "assistant", content: "", steps: [] },
      ]);
      setBusy(true);

      const updateAssistant = (mut: (m: Message) => Message) => {
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? mut(m) : m)),
        );
      };
      const pushStatusStep = (s: Status) => {
        updateAssistant((m) => ({
          ...m,
          steps: [
            ...(m.steps ?? []).map(completeStep),
            { type: "status", data: s, done: false },
          ],
        }));
      };
      const pushToolStep = (
        id: string,
        name: string,
        args: Record<string, unknown>,
      ) => {
        updateAssistant((m) => ({
          ...m,
          steps: [
            ...(m.steps ?? []).map(completeStep),
            { type: "tool", id, name, args, state: "running" },
          ],
        }));
      };
      const finishToolStep = (
        id: string,
        ok: boolean,
        summary: string | undefined,
      ) => {
        updateAssistant((m) => ({
          ...m,
          steps: (m.steps ?? []).map((p) =>
            p.type === "tool" && p.id === id
              ? { ...p, state: ok ? "ok" : "error", summary }
              : p,
          ),
        }));
      };
      const completeAllSteps = () => {
        updateAssistant((m) => ({
          ...m,
          steps: (m.steps ?? []).map(completeStep),
        }));
      };

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
          updateAssistant((m) => ({ ...m, content: msg, error: true }));
          return;
        }

        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
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
              if (data.conversationId) setConversationId(data.conversationId);
            } else if (event.event === "status") {
              pushStatusStep(JSON.parse(event.data) as Status);
            } else if (event.event === "tool_call") {
              const data = JSON.parse(event.data) as {
                id: string;
                name: string;
                args: Record<string, unknown>;
              };
              pushToolStep(data.id, data.name, data.args);
            } else if (event.event === "tool_result") {
              const data = JSON.parse(event.data) as {
                id: string;
                ok: boolean;
                summary?: string;
              };
              finishToolStep(data.id, data.ok, data.summary);
            } else if (event.event === "sources") {
              const data = JSON.parse(event.data) as { sources: Source[] };
              updateAssistant((m) => ({ ...m, sources: data.sources }));
            } else if (event.event === "token") {
              const { delta } = JSON.parse(event.data) as { delta: string };
              updateAssistant((m) => ({ ...m, content: m.content + delta }));
            } else if (event.event === "done") {
              completeAllSteps();
            } else if (event.event === "error") {
              const { message } = JSON.parse(event.data) as { message: string };
              updateAssistant((m) => ({
                ...m,
                content: `Error: ${message}`,
                error: true,
              }));
            }
          }
        }
      } catch (err) {
        updateAssistant((m) => ({
          ...m,
          content: `Error: ${(err as Error).message}`,
          error: true,
        }));
      } finally {
        setBusy(false);
        void refreshHistory();
      }
    },
    [conversationId, selectedSpaceIds, model, refreshHistory],
  );

  React.useEffect(() => {
    if (initialQuery && !initFired.current) {
      initFired.current = true;
      void send(initialQuery);
    }
  }, [initialQuery, send]);

  return (
    <div className="flex h-full bg-background min-h-0">
      <ChatSidebar
        isCollapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
        conversations={history}
        conversationsLoading={historyLoading}
        currentConversationId={conversationId}
        onSelectConversation={(id) => void loadConversation(id)}
        onDeleteConversation={(id) => void deleteConversation(id)}
        onNewChat={startNewChat}
        spaces={spacesWithTrees}
        onSelectDoc={(id) => void loadDoc(id)}
        isAdmin={isAdmin}
        userDisplayName={userDisplayName ?? null}
        userEmail={userEmail ?? null}
      />

      <main className="flex-1 min-w-0 flex flex-col h-full min-h-0">
        {doc ? (
          <DocCenter doc={doc} onClose={() => setDoc(null)} />
        ) : (
          <EmptyCenter />
        )}
      </main>

      <ResizablePanel
        defaultWidth={480}
        minWidth={320}
        maxWidth={1200}
        position="right"
        isCollapsed={chatCollapsed}
        onToggleCollapse={() => setChatCollapsed((v) => !v)}
      >
        <InlineChat
          spaces={spaces}
          selectedSpaceIds={selectedSpaceIds}
          setSelectedSpaceIds={setSelectedSpaceIds}
          model={model}
          setModel={setModel}
          messages={messages}
          inputValue={inputValue}
          setInputValue={setInputValue}
          busy={busy}
          onSend={send}
        />
      </ResizablePanel>
    </div>
  );
}

// ---------- Center pane ----------

function EmptyCenter() {
  return (
    <div className="flex-1 flex items-center justify-center text-center px-8">
      <div className="space-y-3 max-w-md">
        <div className="inline-flex items-center justify-center size-12 rounded-full bg-primary/15">
          <Sparkles className="size-6 text-primary" />
        </div>
        <h1 className="text-xl font-semibold tracking-tight">
          Knowledge Hub
        </h1>
        <p className="text-sm text-muted-foreground">
          Pick a document from the sidebar to read it here, or ask anything in
          the chat on the right. Switch the sidebar between Chats and Docs
          using the tabs.
        </p>
      </div>
    </div>
  );
}

function DocCenter({
  doc,
  onClose,
}: {
  doc: DocState;
  onClose: () => void;
}) {
  return (
    <>
      <div className="border-b border-border px-6 py-3 shrink-0 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <FileText className="size-4 text-muted-foreground shrink-0" />
            <h2 className="text-sm font-semibold truncate">{doc.title}</h2>
          </div>
          <p className="text-[11px] text-muted-foreground truncate mt-0.5">
            {doc.workspace}
            {doc.path ? ` › ${doc.path}` : ""}
          </p>
        </div>
        <button
          onClick={onClose}
          title="Close document"
          className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors shrink-0"
        >
          <X className="size-4" />
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar">
        <article className="max-w-3xl mx-auto px-8 py-8">
          {doc.loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading…
            </div>
          ) : doc.status === "metadata_only" ? (
            <div className="rounded-md border border-border bg-secondary/30 p-4 text-sm text-muted-foreground">
              This file is stored as a binary and isn&apos;t indexed for
              semantic search yet. Open it in the full hub view to download the
              original.
            </div>
          ) : (
            <Markdown source={doc.content} />
          )}
        </article>
      </div>
    </>
  );
}

// ---------- Inline Chat (right panel) ----------

interface InlineChatProps {
  spaces: WorkspaceChatSpace[];
  selectedSpaceIds: string[];
  setSelectedSpaceIds: React.Dispatch<React.SetStateAction<string[]>>;
  model: string;
  setModel: (m: string) => void;
  messages: Message[];
  inputValue: string;
  setInputValue: (v: string) => void;
  busy: boolean;
  onSend: (text: string) => void;
}

function InlineChat({
  spaces,
  selectedSpaceIds,
  setSelectedSpaceIds,
  model,
  setModel,
  messages,
  inputValue,
  setInputValue,
  busy,
  onSend,
}: InlineChatProps) {
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const allSelected = selectedSpaceIds.length === spaces.length;
  const noneSelected = selectedSpaceIds.length === 0;

  const toggleAll = () => {
    setSelectedSpaceIds(allSelected ? [] : spaces.map((s) => s.id));
  };
  const toggleSpace = (id: string) => {
    setSelectedSpaceIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = inputValue.trim();
    if (!text || busy) return;
    setInputValue("");
    onSend(text);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSubmit(e as unknown as React.FormEvent);
    }
  };

  return (
    <div className="w-full border-l border-border flex flex-col h-full min-h-0 bg-background">
      <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar" ref={scrollRef}>
        <div className="pt-12 px-4 pb-4 space-y-5">
          {messages.length === 0 && (
            <div className="text-center text-xs text-muted-foreground px-2 py-6">
              Ask a question about your workspaces. Answers cite their sources
              — always verify before relying on the result.
            </div>
          )}
          {messages.map((m) => (
            <ChatMessageBlock key={m.id} message={m} spaces={spaces} />
          ))}
        </div>
      </div>

      <div className="border-t border-border p-3 space-y-1.5 shrink-0">
        <form onSubmit={onSubmit}>
          <div className="rounded-xl border border-border bg-secondary/30 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/40 transition-colors">
            {spaces.length > 1 && (
              <div className="flex items-center gap-1 flex-wrap px-2.5 pt-2 pb-1.5">
                <button
                  type="button"
                  onClick={toggleAll}
                  className={cn(
                    "inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium transition-colors border",
                    allSelected
                      ? "bg-primary/15 text-primary border-primary/30"
                      : "bg-background text-muted-foreground border-border hover:text-foreground",
                  )}
                >
                  {allSelected && <Check className="size-2.5" />}
                  All
                </button>
                {spaces.map((s) => {
                  const on = selectedSpaceIds.includes(s.id);
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => toggleSpace(s.id)}
                      className={cn(
                        "inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium transition-colors border",
                        on
                          ? "bg-primary/15 text-primary border-primary/30"
                          : "bg-background text-muted-foreground border-border hover:text-foreground",
                      )}
                    >
                      <span className={cn("size-1.5 rounded-full", s.color)} />
                      {s.name}
                    </button>
                  );
                })}
              </div>
            )}
            <Textarea
              placeholder={
                noneSelected
                  ? "Pick at least one workspace…"
                  : "Ask anything…"
              }
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={onKeyDown}
              rows={3}
              disabled={busy || noneSelected}
              className="min-h-[64px] resize-none bg-transparent border-0 focus-visible:ring-0 focus-visible:border-0 text-sm"
            />
            <div className="flex items-center justify-between gap-2 px-2 pb-2">
              <DropdownMenu>
                <DropdownMenuTrigger className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors outline-none">
                  <span>{SHORT_NAMES[model] ?? model}</span>
                  <ChevronDown className="size-3" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="min-w-[200px]">
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
              <Button
                type="submit"
                size="icon-sm"
                disabled={busy || !inputValue.trim() || noneSelected}
                className="size-7 bg-primary hover:bg-primary/90"
              >
                {busy ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Send className="size-3.5" />
                )}
              </Button>
            </div>
          </div>
        </form>
        <p className="text-[10px] text-muted-foreground text-right">
          Enter to send · Shift+Enter for newline
        </p>
      </div>
    </div>
  );
}

// ---------- Message + step rendering ----------

function ChatMessageBlock({
  message,
  spaces,
}: {
  message: Message;
  spaces: WorkspaceChatSpace[];
}) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl bg-primary px-3 py-2 text-sm text-primary-foreground whitespace-pre-wrap">
          {message.content}
        </div>
      </div>
    );
  }

  const cited = new Set<number>();
  CITE_RE.lastIndex = 0;
  let cm: RegExpExecArray | null;
  while ((cm = CITE_RE.exec(message.content)) !== null) {
    cited.add(Number(cm[1]));
  }
  const seen = new Set<number>();
  const displayedSources = (message.sources ?? []).filter((s) => {
    if (cited.size > 0 && !cited.has(s.n)) return false;
    if (seen.has(s.n)) return false;
    seen.add(s.n);
    return true;
  });

  return (
    <div className="space-y-3">
      {message.steps && message.steps.length > 0 && (
        <StepList steps={message.steps} spaces={spaces} />
      )}
      {message.content && (
        <div
          className={cn(
            "rounded-2xl border border-border bg-card px-4 py-3 text-sm leading-relaxed",
            message.error && "border-destructive/40 text-destructive",
          )}
        >
          <Markdown source={stripCitationTags(message.content)} />
        </div>
      )}
      {displayedSources.length > 0 && (
        <div className="space-y-1.5">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium inline-flex items-center gap-1">
            <FileText className="size-3" />
            Sources
          </span>
          <div className="space-y-1">
            {displayedSources.map((s) => (
              <a
                key={`${message.id}-${s.n}`}
                href={`/?doc=${s.documentId}`}
                className="flex items-start gap-2 p-2 rounded border border-border hover:bg-secondary/40 transition-colors group"
              >
                <sup className="flex items-center justify-center size-4 rounded bg-primary/20 text-primary text-[10px] font-medium shrink-0 mt-0.5">
                  {s.n}
                </sup>
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
}

function completeStep(s: Step): Step {
  if (s.type === "status") return { ...s, done: true };
  if (s.type === "tool" && s.state === "running") {
    return { ...s, state: "ok", summary: s.summary ?? "Done." };
  }
  return s;
}

function StepList({
  steps,
  spaces,
}: {
  steps: Step[];
  spaces: WorkspaceChatSpace[];
}) {
  return (
    <div className="rounded-xl border border-border bg-secondary/30 p-2 space-y-1">
      {steps.map((step, i) => (
        <StepRow key={i} step={step} spaces={spaces} />
      ))}
    </div>
  );
}

function StepRow({
  step,
  spaces,
}: {
  step: Step;
  spaces: WorkspaceChatSpace[];
}) {
  if (step.type === "status") {
    return (
      <div className="flex items-center gap-2 text-xs">
        {step.done ? (
          <Check className="size-3.5 text-emerald-500 shrink-0" />
        ) : (
          <Loader2 className="size-3.5 animate-spin text-primary shrink-0" />
        )}
        <span
          className={cn(
            step.done ? "text-muted-foreground" : "text-foreground",
          )}
        >
          {renderStatus(step.data, spaces)}
        </span>
      </div>
    );
  }
  const running = step.state === "running";
  const errored = step.state === "error";
  const Icon = errored ? AlertCircle : running ? Loader2 : Check;
  return (
    <div className="space-y-0.5">
      <div className="flex items-center gap-2 text-xs">
        <Icon
          className={cn(
            "size-3.5 shrink-0",
            running && "animate-spin text-primary",
            !running && !errored && "text-emerald-500",
            errored && "text-destructive",
          )}
        />
        <Wrench className="size-3 text-muted-foreground shrink-0" />
        <span
          className={cn(
            "font-mono text-[11px]",
            running ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {step.name}
          <span className="text-muted-foreground/70">
            ({formatArgs(step.args)})
          </span>
        </span>
      </div>
      {step.summary && !running && (
        <p className="text-[10px] text-muted-foreground ml-9">{step.summary}</p>
      )}
    </div>
  );
}

function renderStatus(
  s: Status,
  spaces: WorkspaceChatSpace[],
): React.ReactNode {
  switch (s.kind) {
    case "searching":
      return s.spaceCount > 0
        ? `Searching ${s.spaceCount} workspace${s.spaceCount === 1 ? "" : "s"}…`
        : `Searching all ${spaces.length} workspaces…`;
    case "searched":
      return s.message;
    case "reranked":
      return `Reranked — keeping top ${s.keptCount}.`;
    case "thinking":
      return s.message;
  }
}

function formatArgs(args: Record<string, unknown>): string {
  const entries = Object.entries(args ?? {});
  if (entries.length === 0) return "";
  return entries
    .map(([k, v]) => {
      let val: string;
      if (typeof v === "string") {
        val = v.length > 30 ? `"${v.slice(0, 30)}…"` : `"${v}"`;
      } else if (Array.isArray(v)) {
        val = `[${v.length}]`;
      } else {
        val = String(v);
      }
      return `${k}: ${val}`;
    })
    .join(", ");
}
