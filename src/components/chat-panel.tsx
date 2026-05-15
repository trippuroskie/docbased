"use client";

import * as React from "react";
import { Sparkles, ThumbsDown, ThumbsUp, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
};

export function ChatPanel({
  spaceIds,
  spaces,
  initialQuery,
}: {
  spaceIds: string[];
  spaces: Array<{ id: string; name: string }>;
  initialQuery?: string;
}) {
  const [model, setModel] = React.useState<string>(CHAT_MODEL_ALLOWLIST[0]);
  const [selectedSpaces, setSelectedSpaces] = React.useState<string[]>(spaceIds);
  const [conversationId, setConversationId] = React.useState<string | null>(null);
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [input, setInput] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const initFired = React.useRef(false);

  const send = React.useCallback(
    async (text: string) => {
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
            conversationId,
            message: text,
            spaceIds: selectedSpaces.length ? selectedSpaces : undefined,
            model,
          }),
        });

        if (!resp.ok || !resp.body) {
          const err = await resp.json().catch(() => ({}));
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, content: `Error: ${err.error ?? resp.statusText}` }
                : m,
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
          let eventSep;
          while ((eventSep = buffer.indexOf("\n\n")) !== -1) {
            const raw = buffer.slice(0, eventSep);
            buffer = buffer.slice(eventSep + 2);
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
            }
          }
        }
      } finally {
        setBusy(false);
      }
    },
    [conversationId, selectedSpaces, model],
  );

  React.useEffect(() => {
    if (initialQuery && !initFired.current) {
      initFired.current = true;
      send(initialQuery);
    }
  }, [initialQuery, send]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || busy) return;
    const text = input.trim();
    setInput("");
    send(text);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b p-3 text-sm">
        <div className="flex items-center gap-2 font-medium">
          <Sparkles className="h-4 w-4" /> Ask AI
        </div>
        <Select value={model} onValueChange={(v) => v && setModel(v)}>
          <SelectTrigger className="h-7 w-[180px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CHAT_MODEL_ALLOWLIST.map((m) => (
              <SelectItem key={m} value={m} className="text-xs">
                {m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <SpaceScopePicker
        spaces={spaces}
        selected={selectedSpaces}
        onChange={setSelectedSpaces}
      />

      <div className="flex-1 overflow-y-auto p-3">
        {messages.length === 0 ? (
          <p className="mx-auto max-w-xs text-center text-sm text-muted-foreground">
            Ask a question about your accessible spaces. Answers cite their
            sources — always verify before relying on the result.
          </p>
        ) : (
          <ul className="space-y-4">
            {messages.map((m) => (
              <li key={m.id}>
                <MessageBubble message={m} />
              </li>
            ))}
            {busy && (
              <li className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> thinking…
              </li>
            )}
          </ul>
        )}
      </div>

      <form onSubmit={onSubmit} className="space-y-2 border-t p-3">
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask a question…"
          rows={2}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              onSubmit(e as unknown as React.FormEvent);
            }
          }}
          disabled={busy}
        />
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">⌘+Enter to send</p>
          <Button type="submit" size="sm" disabled={busy || !input.trim()}>
            Send
          </Button>
        </div>
      </form>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground">
          {message.content}
        </div>
      </div>
    );
  }

  const clean = stripCitationTags(message.content);

  return (
    <div className="space-y-2">
      <div className="whitespace-pre-wrap rounded-lg border bg-card p-3 text-sm">
        {clean || <span className="text-muted-foreground">…</span>}
      </div>
      {message.sources && message.sources.length > 0 && (
        <ul className="flex flex-wrap gap-1">
          {message.sources.map((s) => (
            <li key={s.chunkId}>
              <a
                href={`/doc/${s.documentId}#chunk-${s.chunkId}`}
                className="inline-block"
              >
                <Badge variant="secondary" className="cursor-pointer">
                  {s.n}. {s.title}
                </Badge>
              </a>
            </li>
          ))}
        </ul>
      )}
      <FeedbackButtons messageId={message.id} />
    </div>
  );
}

function FeedbackButtons({ messageId }: { messageId: string }) {
  const [state, setState] = React.useState<"up" | "down" | null>(null);
  const send = async (feedback: "up" | "down") => {
    const next = state === feedback ? null : feedback;
    setState(next);
    await fetch("/api/chat/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageId, feedback: next }),
    }).catch(() => {});
  };
  return (
    <div className="flex gap-1">
      <Button
        type="button"
        variant={state === "up" ? "secondary" : "ghost"}
        size="icon"
        className="h-7 w-7"
        onClick={() => send("up")}
      >
        <ThumbsUp className="h-3 w-3" />
      </Button>
      <Button
        type="button"
        variant={state === "down" ? "secondary" : "ghost"}
        size="icon"
        className="h-7 w-7"
        onClick={() => send("down")}
      >
        <ThumbsDown className="h-3 w-3" />
      </Button>
    </div>
  );
}

function SpaceScopePicker({
  spaces,
  selected,
  onChange,
}: {
  spaces: Array<{ id: string; name: string }>;
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  if (spaces.length <= 1) return null;
  const toggle = (id: string) => {
    onChange(
      selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id],
    );
  };
  return (
    <div className="flex flex-wrap gap-1 border-b p-2">
      {spaces.map((s) => {
        const on = selected.includes(s.id) || selected.length === 0;
        return (
          <Button
            key={s.id}
            type="button"
            variant={on ? "secondary" : "ghost"}
            size="sm"
            className="h-6 text-xs"
            onClick={() => toggle(s.id)}
          >
            {s.name}
          </Button>
        );
      })}
    </div>
  );
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
