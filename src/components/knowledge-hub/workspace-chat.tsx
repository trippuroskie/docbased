"use client";

import * as React from "react";
import {
  Send,
  ChevronDown,
  FileText,
  Loader2,
  Check,
  Sparkles,
  Layers,
  X,
  Wrench,
  AlertCircle,
  ExternalLink,
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
import type { SpaceWithTree } from "./types";

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

type WorkspaceChatSpace = { id: string; name: string; color: string };

interface WorkspaceChatProps {
  spaces: WorkspaceChatSpace[];
  /** Same spaces but with the full tree, for the sidebar Docs tab. */
  spacesWithTrees: SpaceWithTree[];
  isAdmin: boolean;
  initialQuery?: string;
  initialModel?: string;
}

type StoredMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations: Source[] | null;
  created_at: string;
};

type DocPreview = {
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

export function WorkspaceChat({
  spaces,
  spacesWithTrees,
  isAdmin,
  initialQuery,
  initialModel,
}: WorkspaceChatProps) {
  const [model, setModel] = React.useState<string>(
    initialModel ?? CHAT_MODEL_ALLOWLIST[0],
  );
  const [selectedSpaceIds, setSelectedSpaceIds] = React.useState<string[]>(
    () => spaces.map((s) => s.id),
  );
  const [conversationId, setConversationId] = React.useState<string | null>(
    null,
  );
  const [messages, setMessages] = React.useState<Message[]>([]);
  const [inputValue, setInputValue] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const initFired = React.useRef(false);

  // Sidebar state
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false);
  const [history, setHistory] = React.useState<ChatSummary[]>([]);
  const [historyLoading, setHistoryLoading] = React.useState(false);
  const [docPreview, setDocPreview] = React.useState<DocPreview | null>(null);

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

  const openDocPreview = async (docId: string) => {
    // Find metadata locally first for an instant render.
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
    setDocPreview({
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
        setDocPreview((p) => (p ? { ...p, loading: false, content: "Could not load document." } : p));
        return;
      }
      const data = (await resp.json()) as {
        document: {
          id: string;
          title: string;
          path: string;
          workspace: string;
          status: DocPreview["status"];
          tags: string[];
          content: string;
        };
      };
      setDocPreview({
        ...data.document,
        loading: false,
      });
    } catch {
      setDocPreview((p) =>
        p ? { ...p, loading: false, content: "Could not load document." } : p,
      );
    }
  };

  const allSelected = selectedSpaceIds.length === spaces.length;
  const noneSelected = selectedSpaceIds.length === 0;

  const toggleSpace = (id: string) => {
    setSelectedSpaceIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const toggleAll = () => {
    setSelectedSpaceIds(allSelected ? [] : spaces.map((s) => s.id));
  };

  React.useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

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
              const data = JSON.parse(event.data) as Status;
              pushStatusStep(data);
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

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = inputValue.trim();
    if (!text || busy) return;
    setInputValue("");
    void send(text);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSubmit(e as unknown as React.FormEvent);
    }
  };

  const selectedSpaces = spaces.filter((s) => selectedSpaceIds.includes(s.id));
  const isEmpty = messages.length === 0;

  return (
    <div className="flex h-full bg-background">
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
        onSelectDoc={(id) => void openDocPreview(id)}
        isAdmin={isAdmin}
      />

      <div className="flex-1 min-w-0 flex flex-col">
      {/* Top bar */}
      <div className="border-b border-border px-6 py-3 shrink-0 flex items-center justify-end gap-4">
        <DropdownMenu>
          <DropdownMenuTrigger className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors outline-none">
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

      {/* Messages + empty state */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 py-8">
          {isEmpty && (
            <div className="text-center py-12 space-y-3">
              <div className="inline-flex items-center justify-center size-12 rounded-full bg-primary/15">
                <Sparkles className="size-6 text-primary" />
              </div>
              <h1 className="text-2xl font-semibold tracking-tight">
                Ask across your workspaces
              </h1>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                Pick the workspaces below to search across, then ask anything.
                Answers cite their sources — always verify before relying on
                the result.
              </p>
            </div>
          )}

          <div className="space-y-8">
            {messages.map((m) => (
              <MessageBlock key={m.id} message={m} spaces={spaces} />
            ))}
          </div>
        </div>
      </div>

      {/* Composer */}
      <div className="border-t border-border shrink-0">
        <div className="mx-auto max-w-3xl px-6 py-4 space-y-3">
          <WorkspacePicker
            spaces={spaces}
            selected={selectedSpaceIds}
            allSelected={allSelected}
            onToggle={toggleSpace}
            onToggleAll={toggleAll}
          />

          <form onSubmit={onSubmit} className="relative">
            <Textarea
              placeholder={
                noneSelected
                  ? "Pick at least one workspace to search…"
                  : "Ask anything…"
              }
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={onKeyDown}
              rows={3}
              disabled={busy || noneSelected}
              className="min-h-[88px] resize-none bg-secondary/40 pr-14"
            />
            <Button
              type="submit"
              size="icon-sm"
              disabled={busy || !inputValue.trim() || noneSelected}
              className="absolute bottom-2 right-2 size-8 bg-primary hover:bg-primary/90"
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
            </Button>
          </form>
          <p className="text-[10px] text-muted-foreground text-right">
            Enter to send · Shift+Enter for newline
          </p>
        </div>
      </div>
      </div>

      {docPreview && (
        <DocSplitPanel
          doc={docPreview}
          onClose={() => setDocPreview(null)}
        />
      )}
    </div>
  );
}

function DocSplitPanel({
  doc,
  onClose,
}: {
  doc: DocPreview;
  onClose: () => void;
}) {
  return (
    <aside className="w-1/2 min-w-[360px] max-w-[860px] border-l border-border flex flex-col h-full min-h-0 bg-background">
      <div className="border-b border-border px-5 py-3 shrink-0 flex items-start justify-between gap-3">
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
        <div className="flex items-center gap-1 shrink-0">
          <a
            href={`/hub?doc=${doc.id}`}
            target="_blank"
            rel="noreferrer"
            title="Open in full hub view"
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          >
            <ExternalLink className="size-3.5" />
          </a>
          <button
            onClick={onClose}
            title="Close"
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5">
        {doc.loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading…
          </div>
        ) : doc.status === "metadata_only" ? (
          <div className="rounded-md border border-border bg-secondary/30 p-4 text-sm text-muted-foreground">
            This file is stored as metadata only — open it in the Knowledge Hub
            to download the original.
          </div>
        ) : (
          <Markdown source={doc.content} />
        )}
      </div>
    </aside>
  );
}

function findDocInTree(
  nodes: import("@/lib/tree").TreeNode[],
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

function WorkspacePicker({
  spaces,
  selected,
  allSelected,
  onToggle,
  onToggleAll,
}: {
  spaces: WorkspaceChatSpace[];
  selected: string[];
  allSelected: boolean;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
}) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mr-1 inline-flex items-center gap-1">
        <Layers className="size-3" />
        Search in
      </span>
      <button
        type="button"
        onClick={onToggleAll}
        className={cn(
          "inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-colors border",
          allSelected
            ? "bg-primary/15 text-primary border-primary/30"
            : "bg-secondary/40 text-muted-foreground border-border hover:text-foreground",
        )}
      >
        {allSelected && <Check className="size-3" />}
        All
      </button>
      {spaces.map((s) => {
        const on = selected.includes(s.id);
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => onToggle(s.id)}
            className={cn(
              "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors border",
              on
                ? "bg-primary/15 text-primary border-primary/30"
                : "bg-secondary/40 text-muted-foreground border-border hover:text-foreground",
            )}
          >
            <span className={cn("size-1.5 rounded-full", s.color)} />
            {s.name}
            {on && <X className="size-3 opacity-60" />}
          </button>
        );
      })}
    </div>
  );
}

function MessageBlock({
  message,
  spaces,
}: {
  message: Message;
  spaces: WorkspaceChatSpace[];
}) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl bg-primary px-4 py-2.5 text-sm text-primary-foreground whitespace-pre-wrap">
          {message.content}
        </div>
      </div>
    );
  }

  // Determine which sources to actually display: cited in the answer text, deduped.
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
    <div className="space-y-4">
      {message.steps && message.steps.length > 0 && (
        <StepList steps={message.steps} spaces={spaces} />
      )}
      {message.content && (
        <div
          className={cn(
            "rounded-2xl border border-border bg-card px-5 py-4 text-sm leading-relaxed",
            message.error && "border-destructive/40 text-destructive",
          )}
        >
          <Markdown source={stripCitationTags(message.content)} />
        </div>
      )}
      {displayedSources.length > 0 && (
        <div className="space-y-2">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium inline-flex items-center gap-1">
            <FileText className="size-3" />
            Sources
          </span>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {displayedSources.map((s) => (
              <a
                key={`${message.id}-${s.n}`}
                href={`/?doc=${s.documentId}`}
                className="flex items-start gap-2.5 p-3 rounded-lg border border-border hover:bg-secondary/40 hover:border-primary/30 transition-colors group"
              >
                <sup className="flex items-center justify-center size-5 rounded bg-primary/20 text-primary text-xs font-medium shrink-0 mt-0.5">
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
    <div className="rounded-xl border border-border bg-secondary/30 p-3 space-y-1.5">
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
            "transition-colors",
            step.done ? "text-muted-foreground" : "text-foreground",
          )}
        >
          {renderStatus(step.data, spaces)}
        </span>
      </div>
    );
  }

  // tool step
  const running = step.state === "running";
  const errored = step.state === "error";
  const Icon = errored ? AlertCircle : running ? Loader2 : Check;
  return (
    <div className="space-y-1">
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
        <p className="text-[10px] text-muted-foreground ml-9">
          {step.summary}
        </p>
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
        val = v.length > 40 ? `"${v.slice(0, 40)}…"` : `"${v}"`;
      } else if (Array.isArray(v)) {
        val = `[${v.length}]`;
      } else {
        val = String(v);
      }
      return `${k}: ${val}`;
    })
    .join(", ");
}
